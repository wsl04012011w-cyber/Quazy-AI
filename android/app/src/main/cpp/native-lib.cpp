#include <jni.h>
#include <android/log.h>
#include <llama.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <chrono>
#include <iomanip>
#include <mutex>
#include <new>
#include <sstream>
#include <string>
#include <sys/stat.h>
#include <vector>

#define QUAZY_LOG_TAG "QuazyAI"
#define QLOGE(...) __android_log_print(ANDROID_LOG_ERROR, QUAZY_LOG_TAG, __VA_ARGS__)

namespace {
std::mutex g_mutex;
llama_model * g_model = nullptr;
llama_context * g_context = nullptr;
bool g_backend_initialized = false;
int32_t g_prompt_tokens = 0;
int32_t g_generated_tokens = 0;
int32_t g_gpu_layers_used = 0;
int32_t g_threads = 1;
int32_t g_threads_batch = 1;
double g_tokens_per_second = 0.0;
std::string g_last_error;

std::string from_jstring(JNIEnv * env, jstring value) {
    if (value == nullptr) return {};
    const jsize length = env->GetStringLength(value);
    const jchar * chars = env->GetStringChars(value, nullptr);
    if (chars == nullptr) return {};
    std::string result;
    result.reserve(static_cast<size_t>(length) * 3);
    for (jsize i = 0; i < length; ++i) {
        uint32_t cp = chars[i];
        if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < length) {
            const uint32_t low = chars[i + 1];
            if (low >= 0xDC00 && low <= 0xDFFF) {
                cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                ++i;
            }
        }
        if (cp <= 0x7F) result.push_back(static_cast<char>(cp));
        else if (cp <= 0x7FF) {
            result.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            result.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else if (cp <= 0xFFFF) {
            result.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            result.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            result.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
            result.push_back(static_cast<char>(0xF0 | (cp >> 18)));
            result.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
            result.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            result.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
    }
    env->ReleaseStringChars(value, chars);
    return result;
}

jstring to_jstring(JNIEnv * env, const std::string & value) {
    std::u16string utf16;
    utf16.reserve(value.size());
    size_t i = 0;
    while (i < value.size()) {
        const uint8_t lead = static_cast<uint8_t>(value[i]);
        uint32_t cp = 0xFFFD;
        size_t width = 1;
        if (lead <= 0x7F) cp = lead;
        else if (lead >= 0xC2 && lead <= 0xDF) { cp = lead & 0x1F; width = 2; }
        else if (lead >= 0xE0 && lead <= 0xEF) { cp = lead & 0x0F; width = 3; }
        else if (lead >= 0xF0 && lead <= 0xF4) { cp = lead & 0x07; width = 4; }
        bool valid = i + width <= value.size();
        if (valid && width > 1) {
            for (size_t j = 1; j < width; ++j) {
                const uint8_t continuation = static_cast<uint8_t>(value[i + j]);
                if ((continuation & 0xC0) != 0x80) { valid = false; break; }
                cp = (cp << 6) | (continuation & 0x3F);
            }
            if ((width == 3 && cp < 0x800) || (width == 4 && cp < 0x10000) ||
                cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) valid = false;
        }
        if (!valid) {
            cp = 0xFFFD;
            width = 1;
        }
        if (cp <= 0xFFFF) utf16.push_back(static_cast<char16_t>(cp));
        else {
            cp -= 0x10000;
            utf16.push_back(static_cast<char16_t>(0xD800 + (cp >> 10)));
            utf16.push_back(static_cast<char16_t>(0xDC00 + (cp & 0x3FF)));
        }
        i += width;
    }
    return env->NewString(reinterpret_cast<const jchar *>(utf16.data()), static_cast<jsize>(utf16.size()));
}

size_t utf8_complete_prefix(const std::string & value) {
    size_t i = 0;
    while (i < value.size()) {
        const uint8_t lead = static_cast<uint8_t>(value[i]);
        size_t width = 1;
        if (lead <= 0x7F) width = 1;
        else if (lead >= 0xC2 && lead <= 0xDF) width = 2;
        else if (lead >= 0xE0 && lead <= 0xEF) width = 3;
        else if (lead >= 0xF0 && lead <= 0xF4) width = 4;
        else { ++i; continue; }
        if (i + width > value.size()) return i;
        bool valid = true;
        for (size_t j = 1; j < width; ++j) {
            if ((static_cast<uint8_t>(value[i + j]) & 0xC0) != 0x80) { valid = false; break; }
        }
        if (!valid) { ++i; continue; }
        i += width;
    }
    return i;
}

void release_model_locked() {
    if (g_context != nullptr) {
        llama_free(g_context);
        g_context = nullptr;
    }
    if (g_model != nullptr) {
        llama_model_free(g_model);
        g_model = nullptr;
    }
    g_prompt_tokens = 0;
    g_generated_tokens = 0;
    g_gpu_layers_used = 0;
    g_tokens_per_second = 0.0;
}

std::string load_error(const char * message) {
    g_last_error = message;
    return "ERROR:" + g_last_error;
}

void emit_delta(JNIEnv * env, jobject callback, jmethodID method,
                const std::string & output, size_t & emitted_bytes) {
    if (callback == nullptr || method == nullptr) return;
    const size_t safe_size = utf8_complete_prefix(output);
    if (safe_size <= emitted_bytes) return;
    const std::string delta = output.substr(emitted_bytes, safe_size - emitted_bytes);
    emitted_bytes = safe_size;
    const jstring chunk = to_jstring(env, delta);
    if (chunk == nullptr) return;
    env->CallVoidMethod(callback, method, chunk);
    env->DeleteLocalRef(chunk);
    if (env->ExceptionCheck()) {
        QLOGE("Token callback raised a Java exception");
        env->ExceptionClear();
    }
}

ggml_type cache_type_from_int(jint value) {
    switch (value) {
        case 1: return GGML_TYPE_Q8_0;
        case 2: return GGML_TYPE_Q4_0;
        default: return GGML_TYPE_F16;
    }
}
} // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_quazy_ai_NativeBridge_nativeGpuBackendAvailable(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_backend_initialized) {
        llama_backend_init();
        g_backend_initialized = true;
    }
    return llama_supports_gpu_offload() ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_quazy_ai_NativeBridge_nativeLoadModel(
        JNIEnv * env, jobject,
        jstring path_value, jstring backend_dir_value, jint requested_gpu_layers,
        jint requested_context_size, jint requested_threads,
        jint requested_threads_batch, jint requested_batch_size,
        jint requested_ubatch_size, jboolean use_mmap,
        jint cache_type, jint flash_attention_mode,
        jlong available_memory_bytes) {
    std::lock_guard<std::mutex> lock(g_mutex);
    release_model_locked();

    const std::string path = from_jstring(env, path_value);
    if (path.empty()) return to_jstring(env, load_error("Caminho do modelo vazio."));

    struct stat file_info {};
    if (stat(path.c_str(), &file_info) != 0 || file_info.st_size <= 0) {
        return to_jstring(env, load_error("Arquivo GGUF inválido ou inacessível."));
    }

    const uint64_t model_bytes = static_cast<uint64_t>(file_info.st_size);
    const uint64_t available = available_memory_bytes > 0
        ? static_cast<uint64_t>(available_memory_bytes) : 0;
    if (available > 0 && model_bytes + (512ULL * 1024ULL * 1024ULL) > available) {
        return to_jstring(env, load_error(
            "Memória livre insuficiente para uma tentativa segura. Feche outros apps ou escolha um modelo menor."
        ));
    }

    try {
        if (!g_backend_initialized) {
            llama_backend_init();
            g_backend_initialized = true;
        }

        // Dynamic CPU backends are packaged in Android's nativeLibraryDir.
        // The default llama.cpp search path based on /proc/self/exe does not
        // reliably point there for an Android app_process runtime.
        const std::string backend_dir = from_jstring(env, backend_dir_value);
        if (!backend_dir.empty()) {
            ggml_backend_load_all_from_path(backend_dir.c_str());
        }

        const ggml_backend_reg_t cpu_backend = ggml_backend_reg_by_name("CPU");
        if (cpu_backend == nullptr) {
            QLOGE("No CPU backend registered. nativeLibraryDir=%s", backend_dir.c_str());
            release_model_locked();
            return to_jstring(env, load_error(
                "O backend CPU do llama.cpp não foi carregado. Verifique se as bibliotecas libggml-cpu-*.so estão empacotadas no APK."
            ));
        }

        std::string backend_names;
        for (size_t i = 0; i < ggml_backend_reg_count(); ++i) {
            if (!backend_names.empty()) backend_names += ", ";
            backend_names += ggml_backend_reg_name(ggml_backend_reg_get(i));
        }
        QLOGE("llama.cpp %s | registered backends: %s", llama_version(), backend_names.c_str());

        const uint32_t model_context_limit = llama_model_n_ctx_train(g_model);
        const int32_t safe_model_context = static_cast<int32_t>(std::min<uint32_t>(model_context_limit > 0 ? model_context_limit : 8192U, 32768U));
        const int32_t ctx_size = std::clamp<int32_t>(requested_context_size, 512, std::max(512, safe_model_context));
        const int32_t threads = std::clamp<int32_t>(requested_threads, 1, 32);
        const int32_t threads_batch = std::clamp<int32_t>(requested_threads_batch, 1, 32);
        const int32_t batch_size = std::clamp<int32_t>(requested_batch_size, 32, 4096);
        const int32_t ubatch_size = std::clamp<int32_t>(requested_ubatch_size, 16, batch_size);
        const int32_t gpu_layers = std::clamp<int32_t>(requested_gpu_layers, 0, 128);

        if (gpu_layers > 0 && !llama_supports_gpu_offload()) {
            return to_jstring(env, load_error(
                "Este APK foi compilado em modo CPU-only; camadas GPU não estão disponíveis. Use 0 camadas GPU."
            ));
        }

        llama_model_params model_params = llama_model_default_params();
        model_params.n_gpu_layers = gpu_layers;
        model_params.load_mode = use_mmap == JNI_TRUE ? LLAMA_LOAD_MODE_MMAP : LLAMA_LOAD_MODE_NONE;
        model_params.lazy_mode = use_mmap == JNI_TRUE ? LLAMA_LAZY_MODE_AUTO : LLAMA_LAZY_MODE_OFF;

        QLOGE("Loading GGUF: ctx=%d threads=%d batch_threads=%d gpu_layers=%d mmap=%d",
              ctx_size, threads, threads_batch, gpu_layers, use_mmap == JNI_TRUE ? 1 : 0);
        g_model = llama_model_load_from_file(path.c_str(), model_params);
        if (g_model == nullptr) {
            release_model_locked();
            return to_jstring(env, load_error("O llama.cpp não conseguiu abrir este GGUF. Confira se o arquivo está completo e compatível."));
        }

        llama_context_params context_params = llama_context_default_params();
        context_params.n_ctx = static_cast<uint32_t>(ctx_size);
        context_params.n_batch = static_cast<uint32_t>(std::min(batch_size, ctx_size));
        context_params.n_ubatch = static_cast<uint32_t>(std::min(ubatch_size, static_cast<int32_t>(context_params.n_batch)));
        context_params.n_threads = threads;
        context_params.n_threads_batch = threads_batch;
        context_params.type_k = cache_type_from_int(cache_type);
        context_params.type_v = cache_type_from_int(cache_type);
        context_params.flash_attn_type = flash_attention_mode == 1
            ? LLAMA_FLASH_ATTN_TYPE_DISABLED
            : LLAMA_FLASH_ATTN_TYPE_AUTO;

        g_context = llama_init_from_model(g_model, context_params);
        if (g_context == nullptr) {
            release_model_locked();
            return to_jstring(env, load_error(
                "O modelo abriu, mas não foi possível criar o contexto. Reduza o contexto ou use cache F16."
            ));
        }

        g_gpu_layers_used = gpu_layers;
        g_threads = threads;
        g_threads_batch = threads_batch;
        g_last_error.clear();
        return to_jstring(env, "OK:Modelo carregado • CPU • " +
            std::to_string(threads) + " threads geração / " +
            std::to_string(threads_batch) + " threads prompt • contexto " +
            std::to_string(ctx_size));
    } catch (const std::bad_alloc &) {
        release_model_locked();
        return to_jstring(env, load_error("Memória insuficiente durante a alocação do modelo."));
    } catch (const std::exception & error) {
        release_model_locked();
        g_last_error = error.what();
        return to_jstring(env, "ERROR:" + g_last_error);
    } catch (...) {
        release_model_locked();
        return to_jstring(env, load_error("Falha inesperada no carregamento do modelo."));
    }
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_quazy_ai_NativeBridge_nativeGenerate(
        JNIEnv * env, jobject, jstring prompt_value, jint max_tokens_value,
        jint top_k_value, jfloat temperature_value, jfloat top_p_value,
        jfloat repeat_penalty_value, jobject callback) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_model == nullptr || g_context == nullptr) {
        return to_jstring(env, "ERROR:O modelo não está carregado.");
    }

    const std::string prompt = from_jstring(env, prompt_value);
    if (prompt.empty()) return to_jstring(env, "ERROR:Digite uma mensagem antes de enviar.");

    jmethodID callback_method = nullptr;
    if (callback != nullptr) {
        jclass callback_class = env->GetObjectClass(callback);
        if (callback_class != nullptr) {
            callback_method = env->GetMethodID(callback_class, "onToken", "(Ljava/lang/String;)V");
            if (callback_method == nullptr && env->ExceptionCheck()) env->ExceptionClear();
            env->DeleteLocalRef(callback_class);
        }
    }

    llama_sampler * sampler = nullptr;
    try {
        llama_perf_context_reset(g_context);
        llama_memory_clear(llama_get_memory(g_context), true);
        const llama_vocab * vocab = llama_model_get_vocab(g_model);

        std::string formatted_prompt = prompt;
        const char * chat_template = llama_model_chat_template(g_model, nullptr);
        if (chat_template != nullptr && chat_template[0] != '\0') {
            const std::string system_text = "You are Quazy AI, a helpful assistant. Answer clearly in the user's language.";
            llama_chat_message chat[] = {
                {"system", system_text.c_str()},
                {"user", prompt.c_str()}
            };
            const int32_t required = llama_chat_apply_template(chat_template, chat, 2, true, nullptr, 0);
            if (required > 0 && required < 1024 * 1024) {
                std::vector<char> buffer(static_cast<size_t>(required) + 1, '\0');
                const int32_t written = llama_chat_apply_template(
                    chat_template, chat, 2, true, buffer.data(), static_cast<int32_t>(buffer.size())
                );
                if (written > 0) formatted_prompt.assign(buffer.data(), static_cast<size_t>(written));
                else QLOGE("Could not apply model chat template; using raw prompt");
            } else {
                QLOGE("Model chat template is unsupported; using raw prompt");
            }
        }

        std::vector<llama_token> tokens(std::max<size_t>(64, formatted_prompt.size() + 32));
        int32_t token_count = llama_tokenize(
            vocab, formatted_prompt.c_str(), static_cast<int32_t>(formatted_prompt.size()),
            tokens.data(), static_cast<int32_t>(tokens.size()), true, true
        );
        if (token_count < 0) {
            tokens.resize(static_cast<size_t>(-token_count));
            token_count = llama_tokenize(
                vocab, formatted_prompt.c_str(), static_cast<int32_t>(formatted_prompt.size()),
                tokens.data(), static_cast<int32_t>(tokens.size()), true, true
            );
        }
        if (token_count <= 0) return to_jstring(env, "ERROR:Não foi possível tokenizar a mensagem.");
        tokens.resize(static_cast<size_t>(token_count));

        const uint32_t context_limit = llama_n_ctx(g_context);
        if (static_cast<uint32_t>(token_count) + 2 >= context_limit) {
            return to_jstring(env, "ERROR:A mensagem é maior que o contexto atual. Envie um texto menor.");
        }
        if (static_cast<uint32_t>(token_count) > llama_n_batch(g_context)) {
            return to_jstring(env, "ERROR:O prompt excede o batch atual. Aumente o batch ou envie um texto menor.");
        }

        llama_batch batch = llama_batch_get_one(tokens.data(), token_count);
        if (llama_decode(g_context, batch) != 0) {
            return to_jstring(env, "ERROR:O backend CPU não conseguiu processar o prompt.");
        }

        const int32_t max_tokens = std::clamp<int32_t>(
            max_tokens_value, 1, std::min<int32_t>(4096, static_cast<int32_t>(context_limit - token_count - 1))
        );
        const int32_t top_k = std::clamp<int32_t>(top_k_value, 0, 200);
        const float temperature = std::clamp<float>(temperature_value, 0.05f, 2.0f);
        const float top_p = std::clamp<float>(top_p_value, 0.1f, 1.0f);
        const float repeat_penalty = std::clamp<float>(repeat_penalty_value, 1.0f, 1.5f);

        sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
        if (sampler == nullptr) return to_jstring(env, "ERROR:Não foi possível inicializar o sampler.");

        if (temperature <= 0.06f) {
            llama_sampler_chain_add(sampler, llama_sampler_init_greedy());
        } else {
            if (top_k > 0) llama_sampler_chain_add(sampler, llama_sampler_init_top_k(top_k));
            llama_sampler_chain_add(sampler, llama_sampler_init_top_p(top_p, 1));
            // Keep penalties after candidate filtering to avoid scanning the full vocabulary.
            llama_sampler_chain_add(sampler, llama_sampler_init_penalties(
                llama_vocab_n_tokens(vocab), 64, repeat_penalty, 0.0f, 0.0f
            ));
            llama_sampler_chain_add(sampler, llama_sampler_init_temp(temperature));
            llama_sampler_chain_add(sampler, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
        }

        std::string output;
        output.reserve(2048);
        std::vector<char> piece(256);
        size_t emitted_bytes = 0;
        int32_t generated = 0;
        const auto generation_started = std::chrono::steady_clock::now();

        for (int32_t i = 0; i < max_tokens; ++i) {
            const llama_token token = llama_sampler_sample(sampler, g_context, -1);
            llama_sampler_accept(sampler, token);
            if (llama_vocab_is_eog(vocab, token)) break;

            int32_t piece_size = llama_token_to_piece(
                vocab, token, piece.data(), static_cast<int32_t>(piece.size()), 0, false
            );
            if (piece_size < 0) {
                piece.resize(static_cast<size_t>(-piece_size));
                piece_size = llama_token_to_piece(
                    vocab, token, piece.data(), static_cast<int32_t>(piece.size()), 0, false
                );
            }
            if (piece_size > 0) {
                output.append(piece.data(), static_cast<size_t>(piece_size));
            }

            ++generated;
            // Stream each decoded token immediately. The UTF-8 boundary guard
            // prevents partial multibyte characters from reaching React Native.
            emit_delta(env, callback, callback_method, output, emitted_bytes);
            batch = llama_batch_get_one(const_cast<llama_token *>(&token), 1);
            if (llama_decode(g_context, batch) != 0) {
                if (output.empty()) output = "ERROR:O backend interrompeu a geração ao processar um token.";
                else output += "\n[Quazy: geração interrompida pelo backend.]";
                break;
            }
        }

        llama_sampler_free(sampler);
        sampler = nullptr;
        emit_delta(env, callback, callback_method, output, emitted_bytes);

        const auto generation_finished = std::chrono::steady_clock::now();
        const double generation_seconds =
            std::chrono::duration<double>(generation_finished - generation_started).count();
        const llama_perf_context_data perf = llama_perf_context(g_context);
        g_prompt_tokens = perf.n_p_eval;
        g_generated_tokens = generated;
        // Measure sampling + token decode directly instead of relying on perf counters.
        g_tokens_per_second = generation_seconds > 0.0
            ? static_cast<double>(generated) / generation_seconds
            : 0.0;

        if (output.empty()) output = "ERROR:O modelo encerrou a geração sem produzir texto.";
        return to_jstring(env, output);
    } catch (const std::bad_alloc &) {
        if (sampler != nullptr) llama_sampler_free(sampler);
        return to_jstring(env, "ERROR:Memória insuficiente durante a geração. Tente um modelo menor ou menos tokens.");
    } catch (const std::exception & error) {
        if (sampler != nullptr) llama_sampler_free(sampler);
        return to_jstring(env, std::string("ERROR:") + error.what());
    } catch (...) {
        if (sampler != nullptr) llama_sampler_free(sampler);
        return to_jstring(env, "ERROR:Falha inesperada durante a geração nativa.");
    }
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_quazy_ai_NativeBridge_nativeTokenStats(JNIEnv * env, jobject) {
    std::lock_guard<std::mutex> lock(g_mutex);
    std::ostringstream stats;
    stats << "Prompt " << g_prompt_tokens
          << " · gerados " << g_generated_tokens
          << " · " << std::fixed << std::setprecision(1) << g_tokens_per_second << " tok/s"
          << " · CPU " << g_threads << "/" << g_threads_batch;
    return to_jstring(env, stats.str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_quazy_ai_NativeBridge_nativeReleaseModel(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(g_mutex);
    release_model_locked();
}
