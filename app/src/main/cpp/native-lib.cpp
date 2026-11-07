#include <jni.h>
#include <android/log.h>
#include <llama.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <mutex>
#include <new>
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
int32_t g_gpu_layers_requested = 0;
std::string g_last_error;

std::string from_jstring(JNIEnv * env, jstring value) {
    if (value == nullptr) return {};
    const char * chars = env->GetStringUTFChars(value, nullptr);
    if (chars == nullptr) return {};
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}

jstring to_jstring(JNIEnv * env, const std::string & value) {
    return env->NewStringUTF(value.c_str());
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
    g_gpu_layers_requested = 0;
}

std::string load_error(const char * message) {
    g_last_error = message;
    return "ERROR:" + g_last_error;
}
} // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_com_quazy_ai_NativeBridge_nativeLoadModel(
        JNIEnv * env, jobject,
        jstring path_value, jint requested_gpu_layers,
        jint requested_context_size, jlong available_memory_bytes) {
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
    // Keep headroom for the Android UI, context/KV cache and temporary tensors.
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

        const int32_t ctx_size = std::clamp<int32_t>(requested_context_size, 512, 4096);
        const int32_t wanted_layers = std::clamp<int32_t>(requested_gpu_layers, 0, 64);
        std::array<int32_t, 3> layer_attempts = {
            wanted_layers,
            wanted_layers / 2,
            0
        };

        for (size_t attempt = 0; attempt < layer_attempts.size(); ++attempt) {
            const int32_t layers = layer_attempts[attempt];
            if (attempt > 0 && layers == layer_attempts[attempt - 1]) continue;

            llama_model_params model_params = llama_model_default_params();
            model_params.n_gpu_layers = layers;
            model_params.load_mode = LLAMA_LOAD_MODE_MMAP;
            model_params.lazy_mode = LLAMA_LAZY_MODE_OFF;

            QLOGE("Loading GGUF with n_gpu_layers=%d", layers);
            g_model = llama_model_load_from_file(path.c_str(), model_params);
            if (g_model == nullptr) {
                QLOGE("llama_model_load_from_file failed with %d GPU layers", layers);
                continue;
            }

            llama_context_params context_params = llama_context_default_params();
            context_params.n_ctx = static_cast<uint32_t>(ctx_size);
            context_params.n_batch = 256;
            context_params.n_ubatch = 128;
            context_params.n_threads = 4;
            context_params.n_threads_batch = 4;
            g_context = llama_init_from_model(g_model, context_params);

            if (g_context != nullptr) {
                g_gpu_layers_requested = layers;
                g_last_error.clear();
                return to_jstring(env, "OK:Modelo carregado • camadas GPU solicitadas: " +
                    std::to_string(g_gpu_layers_requested) + " • contexto: " + std::to_string(ctx_size));
            }

            llama_model_free(g_model);
            g_model = nullptr;
            QLOGE("Context creation failed with %d GPU layers", layers);
        }

        release_model_locked();
        return to_jstring(env, load_error(
            "O llama.cpp não conseguiu carregar este GGUF com a memória disponível, nem após reduzir o offload. Tente fechar apps e usar contexto menor."
        ));
    } catch (const std::bad_alloc &) {
        release_model_locked();
        return to_jstring(env, load_error("Memória insuficiente durante a alocação do modelo."));
    } catch (...) {
        release_model_locked();
        return to_jstring(env, load_error("Falha inesperada no carregamento do modelo."));
    }
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_quazy_ai_NativeBridge_nativeGenerate(
        JNIEnv * env, jobject, jstring prompt_value, jint max_tokens_value) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_model == nullptr || g_context == nullptr) {
        return to_jstring(env, "Modelo não carregado.");
    }

    const std::string prompt = from_jstring(env, prompt_value);
    if (prompt.empty()) return to_jstring(env, "Digite uma mensagem antes de enviar.");

    try {
        llama_perf_context_reset(g_context);
        llama_memory_clear(llama_get_memory(g_context), true);
        const llama_vocab * vocab = llama_model_get_vocab(g_model);

        std::vector<llama_token> tokens(std::max<size_t>(64, prompt.size() + 16));
        int32_t token_count = llama_tokenize(
            vocab, prompt.c_str(), static_cast<int32_t>(prompt.size()),
            tokens.data(), static_cast<int32_t>(tokens.size()), true, true
        );
        if (token_count < 0) {
            tokens.resize(static_cast<size_t>(-token_count));
            token_count = llama_tokenize(
                vocab, prompt.c_str(), static_cast<int32_t>(prompt.size()),
                tokens.data(), static_cast<int32_t>(tokens.size()), true, true
            );
        }
        if (token_count <= 0) return to_jstring(env, "Não foi possível tokenizar a mensagem.");
        tokens.resize(static_cast<size_t>(token_count));

        const uint32_t context_limit = llama_n_ctx(g_context);
        if (static_cast<uint32_t>(token_count) + 8 >= context_limit) {
            return to_jstring(env, "A mensagem é maior que o contexto atual. Envie um texto menor.");
        }

        llama_batch batch = llama_batch_get_one(tokens.data(), token_count);
        if (llama_decode(g_context, batch) != 0) {
            return to_jstring(env, "Falha ao processar o prompt no backend local.");
        }

        llama_sampler_chain_params sampler_params = llama_sampler_chain_default_params();
        llama_sampler * sampler = llama_sampler_chain_init(sampler_params);
        if (sampler == nullptr) return to_jstring(env, "Não foi possível inicializar o sampler.");
        llama_sampler_chain_add(sampler, llama_sampler_init_greedy());

        const int32_t max_tokens = std::clamp<int32_t>(max_tokens_value, 1, 512);
        std::string output;
        output.reserve(2048);
        std::vector<char> piece(256);
        for (int32_t i = 0; i < max_tokens; ++i) {
            const llama_token token = llama_sampler_sample(sampler, g_context, -1);
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
            if (piece_size > 0) output.append(piece.data(), static_cast<size_t>(piece_size));

            batch = llama_batch_get_one(const_cast<llama_token *>(&token), 1);
            if (llama_decode(g_context, batch) != 0) {
                output += "\n[Quazy: a geração foi interrompida pelo backend.]";
                break;
            }
        }

        llama_sampler_free(sampler);
        const llama_perf_context_data perf = llama_perf_context(g_context);
        g_prompt_tokens = perf.n_p_eval;
        g_generated_tokens = perf.n_eval;
        if (output.empty()) output = "(O modelo não retornou texto.)";
        return to_jstring(env, output);
    } catch (const std::bad_alloc &) {
        return to_jstring(env, "Memória insuficiente durante a geração. Tente um contexto/modelo menor.");
    } catch (...) {
        return to_jstring(env, "Falha inesperada durante a geração.");
    }
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_quazy_ai_NativeBridge_nativeTokenStats(JNIEnv * env, jobject) {
    std::lock_guard<std::mutex> lock(g_mutex);
    return to_jstring(env, "Tokens do llama.cpp • prompt " +
        std::to_string(g_prompt_tokens) + " • gerados " +
        std::to_string(g_generated_tokens) + " • GPU layers requested " +
        std::to_string(g_gpu_layers_requested));
}

extern "C" JNIEXPORT void JNICALL
Java_com_quazy_ai_NativeBridge_nativeReleaseModel(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(g_mutex);
    release_model_locked();
}
