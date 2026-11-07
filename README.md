# Quazy AI

Aplicativo Android de inferência local com [llama.cpp](https://github.com/ggml-org/llama.cpp).

## Estado atual

- Interface Android nativa básica com conversa, seleção de modelo GGUF e botão de envio.
- Contadores de tokens de prompt e de geração lidos de \`llama_perf_context()\`.
- Runtime C++ integrado por JNI.
- Build \`arm64-v8a\` com OpenCL 2.0 e kernels otimizados para Adreno, além de fallback CPU com KleidiAI.
- O modelo é escolhido pelo usuário no armazenamento do aparelho; nenhum modelo é incluído no APK.

## Build

O GitHub Actions gera um APK de teste em cada push para \`main\`. Consulte a aba **Actions** e baixe o artefato \`Quazy-AI-debug-apk\`.

O build fixa o llama.cpp em \`b12189\`. Instruções e notas de compatibilidade: [docs/ANDROID_BUILD.md](docs/ANDROID_BUILD.md).

## Snapdragon 6 Gen 3

A configuração prioriza OpenCL 2.0/Adreno porque a ficha do Snapdragon 6 Gen 3 informa OpenCL 2.0 e Vulkan 1.1, enquanto o backend Vulkan desta versão do llama.cpp requer Vulkan 1.2. A aceleração OpenCL no Adreno 710 ainda precisa ser confirmada no aparelho físico; o fallback CPU permanece disponível.

## Modelos de baixa quantização

O app não reescreve tensores GGUF nem altera kernels de quantização. O suporte a cada formato depende da revisão fixada do llama.cpp e do backend selecionado. A proteção de memória reduz riscos, mas não impede encerramentos forçados pelo Android ou falhas do driver.
