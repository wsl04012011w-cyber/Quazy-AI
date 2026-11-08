# Quazy AI

Aplicativo Android de inferência local com interface React Native e motor [llama.cpp](https://github.com/ggml-org/llama.cpp) em C++/JNI.

## Engine

- React Native 0.81.5; inferência inteiramente nativa em C++/JNI.
- llama.cpp fixado em `v0.9.0`.
- Android ARM64: `GGML_CPU_KLEIDIAI=ON`, `GGML_CPU_REPACK=ON`, `GGML_BACKEND_DL=ON` e `GGML_CPU_ALL_VARIANTS=ON`.
- Variantes CPU dinâmicas: o llama.cpp escolhe em runtime uma variante compatível com os recursos ARM expostos pelo dispositivo.
- Build NDK em `Release`, com OpenMP e bibliotecas backend incluídos no APK.
- OpenCL e Vulkan permanecem desativados até que seus drivers sejam validados no Android do aparelho.

## Build e assinatura

GitHub Actions executa `:app:assembleRelease` e valida a assinatura com `apksigner`. O APK normal usa o ID `com.quazy.ai`, sem o sufixo `.debug`.

Para assinar com uma chave persistente (recomendado para instalar atualizações sem desinstalar o app), configure estes quatro **Repository secrets** em **Settings → Secrets and variables → Actions**:

- `ANDROID_KEYSTORE_BASE64`: keystore JKS codificado em Base64.
- `ANDROID_KEYSTORE_PASSWORD`: senha do keystore.
- `ANDROID_KEY_ALIAS`: alias da chave.
- `ANDROID_KEY_PASSWORD`: senha da chave.

Gere uma chave de assinatura privada em um computador confiável com `keytool` e codifique o arquivo JKS em Base64. Nunca versione o keystore nem coloque as senhas no código. Enquanto esses secrets não existirem, o workflow ainda produz um APK Release assinado com a chave debug temporária do runner; esse artefato serve para teste, mas a assinatura muda a cada execução e não permite atualizar a instalação anterior sem desinstalar.

Artefatos:
- `Quazy-AI-release-signed`: Release assinado com a chave persistente.
- `Quazy-AI-release-test-signed`: Release assinado com a chave debug temporária do runner.

## Modelos

Os GGUF importados são guardados em `files/models` no armazenamento privado do app e permanecem entre aberturas. A pasta é apagada pelo Android ao desinstalar a aplicação.

## Compatibilidade

- ABI: `arm64-v8a`.
- Android mínimo: API 28.
- Compile/target SDK: 36.
- NDK: 27.2.12479018.
- CMake: 3.31.6.
