package com.quazy.ai

import android.app.Activity
import android.app.ActivityManager
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.content.Context
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val bridge by lazy { NativeBridge() }

    private lateinit var statusView: TextView
    private lateinit var tokenView: TextView
    private lateinit var transcriptView: TextView
    private lateinit var transcriptScroll: ScrollView
    private lateinit var promptInput: EditText
    private lateinit var sendButton: Button

    private var modelReady = false
    private val requestedGpuLayers = 24
    private val contextSize = 2048

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildInterface()
        statusView.text = "Selecione um modelo GGUF para começar."
    }

    private fun buildInterface() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(14))
            setBackgroundColor(Color.rgb(17, 22, 31))
        }

        val heading = TextView(this).apply {
            text = "Quazy AI"
            textSize = 27f
            setTextColor(Color.WHITE)
            setPadding(0, 0, 0, dp(4))
        }
        root.addView(heading)

        val subtitle = TextView(this).apply {
            text = "IA local • llama.cpp"
            textSize = 13f
            setTextColor(Color.rgb(158, 174, 194))
        }
        root.addView(subtitle)

        val modelButton = Button(this).apply {
            text = "Selecionar modelo GGUF"
            setOnClickListener { openModelPicker() }
        }
        val modelButtonRow = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(12), 0, dp(4))
            addView(modelButton, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ))
        }
        root.addView(modelButtonRow)

        statusView = TextView(this).apply {
            textSize = 12f
            setTextColor(Color.rgb(180, 195, 214))
            setPadding(0, dp(3), 0, dp(8))
        }
        root.addView(statusView)

        tokenView = TextView(this).apply {
            text = "Tokens: prompt 0 • gerados 0"
            textSize = 12f
            setTextColor(Color.rgb(129, 196, 255))
            setPadding(0, 0, 0, dp(8))
        }
        root.addView(tokenView)

        transcriptScroll = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(Color.rgb(25, 32, 44))
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        transcriptView = TextView(this).apply {
            text = "As conversas são processadas localmente neste aparelho."
            textSize = 15f
            setTextColor(Color.rgb(229, 235, 244))
            setLineSpacing(dp(3).toFloat(), 1f)
        }
        transcriptScroll.addView(transcriptView)
        root.addView(
            transcriptScroll,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            ).apply { topMargin = dp(4); bottomMargin = dp(10) }
        )

        val bottomRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.BOTTOM
        }

        promptInput = EditText(this).apply {
            hint = "Digite sua mensagem..."
            textSize = 15f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(142, 154, 174))
            setBackgroundColor(Color.rgb(35, 44, 59))
            setPadding(dp(12), dp(10), dp(12), dp(10))
            minLines = 1
            maxLines = 4
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            imeOptions = EditorInfo.IME_ACTION_SEND
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_SEND) {
                    sendPrompt()
                    true
                } else {
                    false
                }
            }
        }
        bottomRow.addView(
            promptInput,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )

        sendButton = Button(this).apply {
            text = "Enviar"
            isEnabled = false
            setOnClickListener { sendPrompt() }
        }
        bottomRow.addView(
            sendButton,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { leftMargin = dp(6) }
        )
        root.addView(bottomRow)

        setContentView(root)
    }

    private fun openModelPicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(intent, REQUEST_MODEL)
    }

    @Deprecated("Legacy document picker keeps this first version free of extra AndroidX dependencies.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_MODEL || resultCode != RESULT_OK) return
        val uri: Uri = data?.data ?: return
        copyAndLoadModel(uri)
    }

    private fun copyAndLoadModel(uri: Uri) {
        modelReady = false
        sendButton.isEnabled = false
        statusView.text = "Copiando o modelo para o armazenamento privado..."
        worker.execute {
            try {
                val modelDir = File(cacheDir, "models").apply { mkdirs() }
                val destination = File(modelDir, "selected-model.gguf")
                contentResolver.openInputStream(uri).use { input ->
                    requireNotNull(input) { "Não foi possível abrir o arquivo selecionado." }
                    destination.outputStream().buffered().use { output ->
                        input.copyTo(output, 1024 * 1024)
                    }
                }

                val memory = ActivityManager.MemoryInfo()
                (getSystemService(ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memory)
                val result = bridge.nativeLoadModel(
                    destination.absolutePath,
                    requestedGpuLayers,
                    contextSize,
                    memory.availMem
                )

                runOnUiThread {
                    modelReady = result.startsWith("OK:")
                    statusView.text = result.removePrefix("OK:").removePrefix("ERROR:")
                    sendButton.isEnabled = modelReady
                    if (modelReady) appendMessage("Sistema", "Modelo carregado. Pode enviar uma mensagem.")
                }
            } catch (error: Exception) {
                runOnUiThread {
                    statusView.text = "Falha ao preparar modelo: ${error.message ?: "erro desconhecido"}"
                    modelReady = false
                    sendButton.isEnabled = false
                }
            }
        }
    }

    private fun sendPrompt() {
        val prompt = promptInput.text.toString().trim()
        if (prompt.isEmpty() || !modelReady) return

        promptInput.text.clear()
        sendButton.isEnabled = false
        appendMessage("Você", prompt)
        statusView.text = "Gerando resposta localmente..."

        val keyboard = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        keyboard.hideSoftInputFromWindow(promptInput.windowToken, 0)

        worker.execute {
            val answer = try {
                bridge.nativeGenerate(prompt, 256)
            } catch (error: Exception) {
                "Erro na inferência: ${error.message ?: "erro desconhecido"}"
            }
            val stats = bridge.nativeTokenStats()
            runOnUiThread {
                appendMessage("Quazy", answer)
                tokenView.text = stats
                statusView.text = "Pronto • inferência local"
                sendButton.isEnabled = modelReady
            }
        }
    }

    private fun appendMessage(author: String, message: String) {
        transcriptView.append("\n\n$author\n$message")
        transcriptScroll.post { transcriptScroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        worker.execute { bridge.nativeReleaseModel() }
        worker.shutdown()
        super.onDestroy()
    }

    companion object {
        private const val REQUEST_MODEL = 4101
    }
}
