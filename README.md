# Quazy AI

Aplicativo Android de inferência local com [llama.cpp](https://github.com/ggml-org/llama.cpp).

## Estado atual

- Interface Android nativa básica com conversa, seleção de modelo GGUF e botão de envio.
- Contadores de tokens de prompt e de geração lidos de `llama_perf_context()`.
- Runtime C++ integrado por JNI.
- Build para `arm64-v8a`, com backend Vulkan habilitado e fallback de CPU.
- O modelo é escolhido pelo usuário no armazenamento do aparelho; nenhum modelo é incluído no APK.

## Build

O GitHub Actions gera um APK de teste em cada push para `main`. Consulte a aba **Actions** e baixe o artefato `Quazy-AI-debug-apk).

O build usa o NDK Android e fixa o llama.cpp em `b12189` para que o resultado seja reproduzível. Instruções adicionais: [docs/ANDROID_BUILD.md](docs/ANDROID_BUILD.md).

## Limitações desta versão

A aceleração Vulkan depende de um driver Vulkan funcional no aparelho. O Snapdragon 6 Gen 3 anuncia Vulkan 1.1; ainda assim, o comportamento do driver Adreno precisa ser validado no dispositivo físico. Se o carregamento com offload não funcionar, o runtime tenta reduzir as camadas na GPU e, por último, usar CPU.

O pré-check de memória e os limites conservadores reduzem a chance de encerramento ao abrir modelos grandes, mas nenhum aplicativo consegue interceptar com garantia um encerramento forçado pelo Android ou pelo driver. O suporte a cada quantização GGUF continua dependendo da versão do llama.cpp selecionada.

## Estrutura

```
app/
  src/main/
    cpp/                 # CMake + JNI + llama.cpp
    java/com/quazy/ai/   # interface Android
.github/workflows/       # build automático de APK
docs/                    # instruções e decisões técnicas
```
