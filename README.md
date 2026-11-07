# Quazy AI

Aplicativo Android de inferência local com interface React Native e motor [llama.cpp](https://github.com/ggml-org/llama.cpp) em C++/JNI.

## Estado atual

- Interface React Native com tema claro, conversa, seletor GGUF e campo de mensagem.
- Motor llama.cpp continua nativo em C++ via JNI; React Native controla apenas a interface.
- Contadores de tokens obtidos de \`llama_perf_context()\`.
- Build \`arm64-v8a\` para Android 9 ou superior.
- Projeto Android organizado em \`android/\`, com o código JavaScript/React Native na raiz.
- Diagnóstico exportado automaticamente para \`Downloads/QuazyAI\` ao iniciar.
- Build CPU-only nesta revisão: OpenCL foi desativado porque os logs do aparelho mostraram que \`libOpenCL.so\` não está disponível para o app.

## Build

O GitHub Actions gera um APK de teste em cada push para \`main\`. Consulte a aba **Actions** e baixe o artefato \`Quazy-AI-debug-apk\`.

O build fixa o llama.cpp em \`b12189\`. Dependências React Native estão descritas em \`package.json\`.

## Aceleração

Esta versão prioriza estabilidade e carregamento de modelos com CPU. A aceleração por GPU não é anunciada como ativa. O backend OpenCL anterior falhava no aparelho por dependência ausente do driver; um backend de GPU deverá ser reintroduzido apenas depois de validar a disponibilidade e a compatibilidade no dispositivo físico.
