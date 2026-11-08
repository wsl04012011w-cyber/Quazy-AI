import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Alert,
  DeviceEventEmitter,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

const Native = NativeModules.QuazyNative;
const ENGINE_KEYS = [
  'threads', 'threadsBatch', 'contextSize', 'batchSize', 'ubatchSize',
  'gpuLayers', 'useMmap', 'cacheType', 'flashAttention',
];

const DEFAULT_SETTINGS = {
  threads: 4,
  threadsBatch: 8,
  contextSize: 2048,
  batchSize: 512,
  ubatchSize: 128,
  gpuLayers: 0,
  useMmap: true,
  cacheType: 'f16',
  flashAttention: 'auto',
  maxTokens: 128,
  topK: 40,
  temperature: 0.7,
  topP: 0.9,
  repeatPenalty: 1.05,
};

const THOUGHT_TAG_PATTERN = /(?:think|analys|reason|thought|scratch|reflect|deliberat|internal|cognit|rationale|chain.?of.?thought|justify|brainstorm|planning|plan|work|cot|trace|monologue|working)/i;
const FINAL_TAG_PATTERN = /^(?:final|answer|response|output)$/i;

function parseAssistantOutput(rawText) {
  const raw = String(rawText || '');
  const thinkingParts = [];
  const answerParts = [];
  let mode = 'answer';
  let hasThinking = false;
  let thinkingOpen = false;
  let cursor = 0;

  const append = value => {
    if (!value) return;
    (mode === 'thinking' ? thinkingParts : answerParts).push(value);
  };

  // Supports XML-like tags (<think>, <Thinking>, <analysis>, <reasoning>...),
  // common reasoning tokens and Harmony-style channel markers.
  const markerPattern = /<\|(?:begin_of_thought|start_of_thought|startofthought|begin_of_analysis|start_of_analysis)\|>|<\|(?:end_of_thought|endofthought|end_thought|end_of_analysis)\|>|<\|channel\|>\s*(analysis|final|commentary|justify|confidence|summary|thinking|think|reasoning|thought)\b|<\|(analysis|final|commentary|thinking|think|reasoning|thought)\|>|<\/?([a-z][a-z0-9_-]*)\s*>/gi;

  let match;
  while ((match = markerPattern.exec(raw)) !== null) {
    append(raw.slice(cursor, match.index));
    cursor = markerPattern.lastIndex;
    const marker = match[0].toLowerCase();

    if (/^<\|(?:begin_of_thought|start_of_thought|startofthought)\|>$/.test(marker)) {
      mode = 'thinking';
      hasThinking = true;
      thinkingOpen = true;
      continue;
    }
    if (/^<\|(?:end_of_thought|endofthought|end_thought)\|>$/.test(marker)) {
      mode = 'answer';
      thinkingOpen = false;
      continue;
    }

    const channel = (match[1] || match[2] || '').toLowerCase();
    if (channel) {
      if (THOUGHT_TAG_PATTERN.test(channel) || channel === 'commentary' || channel === 'confidence' || channel === 'summary') {
        mode = 'thinking';
        hasThinking = true;
        thinkingOpen = true;
      } else {
        mode = 'answer';
        thinkingOpen = false;
      }
      continue;
    }

    const tagName = (match[3] || '').toLowerCase();
    if (!tagName) continue;
    if (THOUGHT_TAG_PATTERN.test(tagName)) {
      hasThinking = true;
      if (marker.startsWith('</')) {
        mode = 'answer';
        thinkingOpen = false;
      } else {
        mode = 'thinking';
        thinkingOpen = true;
      }
      continue;
    }
    if (FINAL_TAG_PATTERN.test(tagName)) {
      mode = 'answer';
      thinkingOpen = false;
      continue;
    }

    // Unknown markup is ordinary model text; keep it rather than deleting it.
    append(match[0]);
  }

  let tail = raw.slice(cursor);
  // A tag can arrive split across tokens. Hold an unfinished marker until the
  // next streaming chunk so fragments such as "<thi" never flash in the chat.
  const partialMarker = tail.lastIndexOf('<');
  if (partialMarker >= 0 && /^<\/?[a-z0-9_:-]*$/i.test(tail.slice(partialMarker))) {
    tail = tail.slice(0, partialMarker);
  }
  append(tail);

  return {
    hasThinking,
    thinking: thinkingParts.join('').trim(),
    answer: answerParts.join('').trimStart(),
    thinkingOpen,
  };
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Tamanho desconhecido';
  if (bytes >= 1024 ** 3) return (bytes / (1024 ** 3)).toFixed(2) + ' GB';
  return (bytes / (1024 ** 2)).toFixed(0) + ' MB';
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState('Importe um modelo GGUF para começar.');
  const [modelReady, setModelReady] = useState(false);
  const [modelName, setModelName] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [models, setModels] = useState([]);
  const [cpuCores, setCpuCores] = useState(8);
  const [gpuAvailable, setGpuAvailable] = useState(false);
  const [tokenStats, setTokenStats] = useState('');
  const listRef = useRef(null);
  const activeRequest = useRef(null);
  const loadedConfigRef = useRef(null);
  const pendingStreamRef = useRef('');
  const streamTimerRef = useRef(null);
  const dotBounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!busy) {
      dotBounce.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(dotBounce, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(dotBounce, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [busy, dotBounce]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [device, saved, storedModels] = await Promise.all([
          Native.getDeviceInfo(),
          Native.getEngineSettings(),
          Native.listModels(),
        ]);
        if (!mounted) return;
        const cores = Math.max(1, Number(device?.cpuCores) || 8);
        setCpuCores(cores);
        setGpuAvailable(Boolean(device?.gpuBackendAvailable));
        const savedThreads = Number(saved?.threads) || 4;
        // Earlier builds defaulted to 6 generation threads; migrate that default
        // to 4, which better matches the Termux benchmark on this device.
        const preferredThreads = savedThreads === 6 ? 4 : savedThreads;
        const merged = {
          ...DEFAULT_SETTINGS,
          ...saved,
          threads: Math.min(preferredThreads, cores),
          threadsBatch: Math.min(Number(saved?.threadsBatch) || cores, cores),
          gpuLayers: device?.gpuBackendAvailable ? Number(saved?.gpuLayers) || 0 : 0,
        };
        setSettings(merged);
        setModels(Array.isArray(storedModels) ? storedModels : []);
        setSettingsReady(true);
      } catch (error) {
        if (mounted) {
          setCpuCores(8);
          setStatus('Não foi possível ler as configurações do motor: ' + (error?.message || 'erro nativo'));
          setSettingsReady(true);
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('QuazyToken', event => {
      const active = activeRequest.current;
      if (!active || event?.requestId !== active.requestId || typeof event?.text !== 'string') return;
      pendingStreamRef.current += event.text;
      if (streamTimerRef.current == null) {
        streamTimerRef.current = setTimeout(() => {
          const chunk = pendingStreamRef.current;
          pendingStreamRef.current = '';
          streamTimerRef.current = null;
          if (!chunk) return;
          setMessages(current => current.map(item =>
            item.id === active.messageId ? {...item, text: item.text + chunk, streaming: true} : item,
          ));
        }, 32);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (settingsReady) Native.saveEngineSettings(settings).catch(() => {});
  }, [settings, settingsReady]);

  useEffect(() => () => {
    try { Native?.releaseModel?.(); } catch (_) {}
  }, []);

  const updateSetting = (key, value) => setSettings(current => ({...current, [key]: value}));

  const refreshModels = async () => {
    const result = await Native.listModels();
    setModels(Array.isArray(result) ? result : []);
  };

  const loadModelDirect = async name => {
    const result = await Native.loadModel(name, settings);
    if (typeof result !== 'string' || !result.startsWith('OK:')) {
      throw new Error((result || 'Não foi possível carregar o modelo.').replace(/^ERROR:/, ''));
    }
    setModelReady(true);
    setModelName(name);
    setModels(current => current.map(model => ({...model, loaded: model.name === name})));
    loadedConfigRef.current = {...settings};
    setStatus(result.slice(3).trim());
    setMessages(current => current.length ? current : [{
      id: 'welcome',
      role: 'assistant',
      text: 'Modelo pronto. Suas mensagens são processadas localmente neste aparelho.',
    }]);
    await refreshModels();
  };

  const loadStoredModel = async name => {
    if (busy) return;
    setBusy(true);
    setStatus('Carregando modelo da biblioteca do app…');
    try {
      await loadModelDirect(name);
      setModelsOpen(false);
    } catch (error) {
      // Native load replaces the previous engine before attempting the new one.
      // If it fails, clear every JS-side marker for the old model as well.
      setModelReady(false);
      setModelName('');
      loadedConfigRef.current = null;
      setStatus(error?.message || 'Falha ao carregar o modelo.');
      await refreshModels().catch(() => {});
      Alert.alert('Não foi possível carregar', error?.message || 'Confira o arquivo e as opções de memória.');
    } finally {
      setBusy(false);
    }
  };

  const unloadStoredModel = async name => {
    if (busy) return;
    setBusy(true);
    setStatus('Descarregando modelo…');
    try {
      await Native.unloadModel();
      setModelReady(false);
      setModelName('');
      setModels(current => current.map(model => ({...model, loaded: false})));
      loadedConfigRef.current = null;
      setStatus('Modelo descarregado. O arquivo continua salvo na biblioteca.');
      await refreshModels();
    } catch (error) {
      setStatus(error?.message || 'Erro ao liberar o modelo.');
      Alert.alert('Não foi possível descarregar', error?.message || 'Erro ao liberar o modelo.');
      await refreshModels().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const importModel = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('Escolha o arquivo GGUF…');
    try {
      const importedName = await Native.pickAndImportModel();
      if (importedName === 'CANCELLED') {
        setStatus('Importação cancelada.');
        return;
      }
      await refreshModels();
      setStatus('GGUF copiado para a biblioteca. Iniciando engine…');
      await loadModelDirect(importedName);
      setModelsOpen(false);
    } catch (error) {
      const reason = error?.message || 'O Android não conseguiu importar ou carregar o modelo.';
      setStatus('Falha ao importar/carregar GGUF: ' + reason);
      Alert.alert('Falha ao importar/carregar GGUF', reason);
      try {
        const stored = await Native.listModels();
        const loaded = Array.isArray(stored) ? stored.find(model => model.loaded) : null;
        setModels(Array.isArray(stored) ? stored : []);
        if (!loaded) {
          setModelReady(false);
          setModelName('');
          loadedConfigRef.current = null;
        }
      } catch (_) {}
    } finally {
      setBusy(false);
    }
  };

  const deleteStoredModel = name => {
    Alert.alert('Remover modelo', 'Excluir ' + name + ' da pasta privada do Quazy AI?', [
      {text: 'Cancelar', style: 'cancel'},
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          try {
            await Native.deleteModel(name);
            await refreshModels();
          } catch (error) {
            Alert.alert('Não foi possível excluir', error?.message || 'Erro ao remover arquivo.');
          }
        },
      },
    ]);
  };

  const engineNeedsReload = Boolean(
    modelReady && loadedConfigRef.current &&
    ENGINE_KEYS.some(key => loadedConfigRef.current[key] !== settings[key]),
  );

  const sendMessage = async () => {
    const text = prompt.trim();
    if (!text || !modelReady || busy) return;
    if (!Native?.generate) {
      setStatus('Módulo de geração indisponível.');
      return;
    }

    const requestId = String(Date.now());
    const messageId = requestId + '-assistant';
    setPrompt('');
    setMessages(current => [
      ...current,
      {id: requestId + '-user', role: 'user', text},
      {id: messageId, role: 'assistant', text: '', streaming: true, thinkingExpanded: true},
    ]);
    activeRequest.current = {requestId, messageId};
    setBusy(true);
    setStatus('Gerando resposta no aparelho…');

    try {
      const result = await Native.generate(
        text,
        settings.maxTokens,
        settings.topK,
        settings.temperature,
        settings.topP,
        settings.repeatPenalty,
        requestId,
      );
      if (streamTimerRef.current != null) { clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
      const finalChunk = pendingStreamRef.current;
      pendingStreamRef.current = '';
      const answer = typeof result?.answer === 'string' ? result.answer.trim() : '';
      setMessages(current => current.map(item =>
        item.id === messageId
          ? {...item, text: answer || (item.text + finalChunk) || 'O modelo terminou sem retornar texto.', streaming: false}
          : item,
      ));
      setTokenStats(result?.stats || '');
      setStatus('Pronto · inferência local');
    } catch (error) {
      if (streamTimerRef.current != null) { clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
      const finalChunk = pendingStreamRef.current;
      pendingStreamRef.current = '';
      const reason = error?.message || 'erro nativo desconhecido';
      setMessages(current => current.map(item =>
        item.id === messageId
          ? {...item, text: (item.text + finalChunk) || ('Não foi possível gerar a resposta. ' + reason), streaming: false, error: !item.text}
          : item,
      ));
      setStatus('A geração falhou. Veja a mensagem no chat.');
    } finally {
      if (activeRequest.current?.requestId === requestId) activeRequest.current = null;
      setBusy(false);
    }
  };

  const clearConversation = () => {
    if (busy) return;
    setMessages([]);
    pendingStreamRef.current = '';
    if (streamTimerRef.current != null) { clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
    setPrompt('');
    setTokenStats('');
    setMenuOpen(false);
    setModelsOpen(false);
    setSettingsOpen(false);
  };

  const Chip = ({label, selected, onPress, disabled}) => (
    <Pressable disabled={disabled} onPress={onPress} style={[s.chip, selected && s.chipSelected, disabled && s.disabled]}>
      <Text style={[s.chipText, selected && s.chipTextSelected]}>{label}</Text>
    </Pressable>
  );

  const renderMessage = ({item}) => {
    const user = item.role === 'user';
    if (user) {
      return (
        <View style={[s.messageRow, s.userRow]}>
          <View style={[s.bubble, s.userBubble]}>
            <Text style={[s.message, s.userMessage]}>{item.text}</Text>
          </View>
        </View>
      );
    }

    const raw = item.text || '';
    const parsed = parseAssistantOutput(raw);
    const hasThinking = parsed.hasThinking;
    const thinking = parsed.thinking;
    const answer = parsed.answer;
    const showThinking = Boolean(item.thinkingExpanded);

    return (
      <View style={[s.messageRow, s.assistantRow, s.assistantMessageRow]}>
        {hasThinking && (
          <View style={s.thinkingContainer}>
            <Pressable
              onPress={() => setMessages(current => current.map(message =>
                message.id === item.id
                  ? {...message, thinkingExpanded: !message.thinkingExpanded}
                  : message,
              ))}
              style={s.thinkingToggle}
            >
              <Text style={s.thinkingChevron}>{showThinking ? '⌄' : '›'}</Text>
              <Text style={s.thinkingTitle}>{item.streaming && parsed.thinkingOpen ? 'Pensando…' : 'Pensamento do modelo'}</Text>
              {item.streaming && parsed.thinkingOpen && <ActivityIndicator size="small" color="#8A85C9" />}
            </Pressable>
            {showThinking && Boolean(thinking) && (
              <Text style={s.thinkingText}>{thinking}</Text>
            )}
          </View>
        )}
        {Boolean(answer) && (
          <Text style={[s.message, s.assistantMessage, item.error && s.errorMessage]}>
            {answer.trimStart()}
            {item.streaming ? (
              <Animated.Text
                style={[
                  s.liveDot,
                  {fontSize: dotBounce.interpolate({inputRange: [0, 1], outputRange: [7, 11]})},
                ]}
              >●</Animated.Text>
            ) : null}
          </Text>
        )}
        {item.streaming && (
          <View style={s.streamStatus}>
            {!raw && <ActivityIndicator size="small" color="#7168D9" />}
            <Text style={s.streamText}>{raw ? 'Gerando…' : 'Pensando…'}</Text>
          </View>
        )}
        {item.error && !answer && <Text style={s.messageError}>{raw}</Text>}
      </View>
    );
  };

  const threadOptions = [1, 2, 4, 6, 8].filter(value => value <= cpuCores);
  const ubatchOptions = [32, 64, 128, 256].filter(value => value <= settings.batchSize);

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={s.header}>
        <View style={s.logo}><Text style={s.logoText}>Q</Text></View>
        <View style={s.brand}>
          <Text style={s.title}>Quazy AI</Text>
          <View style={s.statusLine}>
            <View style={[s.dot, modelReady && s.dotReady]} />
            <Text style={s.subtitle}>{modelReady ? 'Modelo local pronto' : 'Assistente local'}</Text>
          </View>
        </View>
        <Pressable onPress={clearConversation} disabled={busy} style={s.newChatButton} accessibilityLabel="Novo chat">
          <Text style={s.newChatGlyph}>＋</Text>
        </Pressable>
        <Pressable onPress={() => setMenuOpen(true)} style={s.menuButton} accessibilityLabel="Abrir menu">
          <Text style={s.menuGlyph}>•••</Text>
        </Pressable>
      </View>

      <View style={s.chatBar}>
        <Text style={s.chatTitle}>Conversa</Text>
        <Text style={s.chatMeta}>{busy ? 'Processando' : tokenStats || (modelReady ? modelName : 'Biblioteca local')}</Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        contentContainerStyle={[s.messages, messages.length === 0 && s.emptyList]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({animated: true})}
        ListEmptyComponent={
          <View style={s.empty}>
            <View style={s.emptyLogo}><Text style={s.emptyQ}>Q</Text></View>
            <Text style={s.emptyTitle}>O que vamos descobrir?</Text>
            <Text style={s.emptyText}>
              {modelReady
                ? 'Seu modelo está pronto. Envie uma mensagem para começar.'
                : 'Importe um GGUF. Ele ficará guardado na biblioteca do Quazy AI para os próximos usos.'}
            </Text>
            {!modelReady && (
              <Pressable onPress={() => setModelsOpen(true)} style={s.emptyButton}>
                <Text style={s.emptyButtonText}>Abrir biblioteca</Text>
              </Pressable>
            )}
          </View>
        }
      />

      <KeyboardAvoidingView style={s.composerDock} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <View style={s.composer}>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder={modelReady ? 'Escreva sua mensagem…' : 'Carregue um modelo para conversar'}
            placeholderTextColor="#9AA1B2"
            style={s.input}
            multiline
            maxLength={6000}
            editable={modelReady && !busy}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={sendMessage}
          />
          <Pressable
            onPress={sendMessage}
            disabled={!modelReady || !prompt.trim() || busy}
            style={({pressed}) => [s.send, (!modelReady || !prompt.trim() || busy) && s.sendDisabled, pressed && s.pressed]}
          >
            {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={s.sendGlyph}>↑</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <View style={s.modalBackdrop}>
          <Pressable style={s.backdropDismiss} onPress={() => setMenuOpen(false)} />
          <View style={[s.menuSheet, s.menuChoiceSheet]}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <View>
                <Text style={s.sheetTitle}>Menu</Text>
                <Text style={s.sheetSubtitle}>Quazy AI</Text>
              </View>
              <Pressable onPress={() => setMenuOpen(false)} style={s.closeButton}>
                <Text style={s.closeGlyph}>×</Text>
              </Pressable>
            </View>
            <Pressable style={s.menuOption} onPress={() => { setMenuOpen(false); setModelsOpen(true); }}>
              <View style={s.menuOptionIcon}><Text style={s.menuOptionGlyph}>▤</Text></View>
              <View style={s.menuOptionCopy}>
                <Text style={s.menuOptionTitle}>Modelos</Text>
                <Text style={s.menuOptionHint}>Importar, carregar ou remover GGUF</Text>
              </View>
              <Text style={s.menuOptionArrow}>›</Text>
            </Pressable>
            <Pressable style={s.menuOption} onPress={() => { setMenuOpen(false); setSettingsOpen(true); }}>
              <View style={s.menuOptionIcon}><Text style={s.menuOptionGlyph}>⚙</Text></View>
              <View style={s.menuOptionCopy}>
                <Text style={s.menuOptionTitle}>Configurações</Text>
                <Text style={s.menuOptionHint}>CPU, memória e parâmetros de geração</Text>
              </View>
              <Text style={s.menuOptionArrow}>›</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={modelsOpen} transparent animationType="slide" onRequestClose={() => setModelsOpen(false)}>
        <View style={s.modalBackdrop}>
          <Pressable style={s.backdropDismiss} onPress={() => setModelsOpen(false)} />
          <View style={s.menuSheet}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <View>
                <Text style={s.sheetTitle}>Modelos</Text>
                <Text style={s.sheetSubtitle}>Biblioteca local de GGUF</Text>
              </View>
              <Pressable onPress={() => setModelsOpen(false)} style={s.closeButton}>
                <Text style={s.closeGlyph}>×</Text>
              </Pressable>
            </View>
            <ScrollView
              style={s.settingsScroll}
              contentContainerStyle={s.settingsScrollContent}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="always"
              nestedScrollEnabled
              overScrollMode="never"
            >
                            <Text style={s.sectionTitle}>BIBLIOTECA DE MODELOS</Text>
              <Pressable onPress={importModel} disabled={busy} style={[s.importButton, busy && s.disabled]}>
                {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={s.importGlyph}>＋</Text>}
                <Text style={s.importButtonText}>Importar arquivo GGUF</Text>
              </Pressable>
              <Text style={s.settingHint}>Os arquivos são copiados para o armazenamento privado do app e permanecem lá entre aberturas.</Text>
              {models.length === 0 ? (
                <Text style={s.emptyModels}>Nenhum modelo salvo ainda.</Text>
              ) : models.map(model => (
                <View key={model.name} style={s.modelItem}>
                  <View style={s.modelItemCopy}>
                    <Text style={s.modelItemName} numberOfLines={1}>{model.name}</Text>
                    <Text style={s.settingHint}>{formatSize(model.sizeBytes)}{model.loaded ? ' · carregado' : ''}</Text>
                  </View>
                  <Pressable
                    onPress={() => model.loaded ? unloadStoredModel(model.name) : loadStoredModel(model.name)}
                    disabled={busy}
                    style={[s.modelLoadButton, model.loaded && s.modelUnloadButton, busy && s.disabled]}
                  >
                    <Text style={[s.modelLoadText, model.loaded && s.modelUnloadText]}>
                      {model.loaded ? 'Descarregar' : 'Carregar'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => deleteStoredModel(model.name)} disabled={busy || model.loaded} style={[s.deleteModelButton, (busy || model.loaded) && s.disabled]}>
                    <Text style={s.deleteModelText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal visible={settingsOpen} transparent animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <View style={s.modalBackdrop}>
          <Pressable style={s.backdropDismiss} onPress={() => setSettingsOpen(false)} />
          <View style={s.menuSheet}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <View>
                <Text style={s.sheetTitle}>Configurações</Text>
                <Text style={s.sheetSubtitle}>Desempenho e geração local</Text>
              </View>
              <Pressable onPress={() => setSettingsOpen(false)} style={s.closeButton}>
                <Text style={s.closeGlyph}>×</Text>
              </Pressable>
            </View>
            <ScrollView
              style={s.settingsScroll}
              contentContainerStyle={s.settingsScrollContent}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="always"
              nestedScrollEnabled
              overScrollMode="never"
            >
                            <Text style={s.sectionTitle}>CPU</Text>
              <Text style={s.settingName}>Threads de geração: {settings.threads}</Text>
              <Text style={s.settingHint}>Usadas na geração de um token por vez. O aparelho informou {cpuCores} CPUs disponíveis.</Text>
              <View style={s.chipRow}>
                {threadOptions.map(value => (
                  <Chip key={value} label={String(value)} selected={settings.threads === value} onPress={() => updateSetting('threads', value)} />
                ))}
              </View>
              <Text style={[s.settingName, s.settingGap]}>Threads de prompt/batch: {settings.threadsBatch}</Text>
              <Text style={s.settingHint}>Mais threads podem acelerar a leitura inicial do prompt.</Text>
              <View style={s.chipRow}>
                {threadOptions.map(value => (
                  <Chip key={value} label={String(value)} selected={settings.threadsBatch === value} onPress={() => updateSetting('threadsBatch', value)} />
                ))}
              </View>

              <Text style={s.sectionTitle}>CONTEXTO E MEMÓRIA</Text>
              <Text style={s.settingName}>Contexto (tokens)</Text>
              <View style={s.chipRow}>
                {[1024, 2048, 4096, 8192, 16384, 32768].map(value => (
                  <Chip key={value} label={String(value)} selected={settings.contextSize === value} onPress={() => updateSetting('contextSize', value)} />
                ))}
              </View>
              <Text style={[s.settingName, s.settingGap]}>Batch size: {settings.batchSize}</Text>
              <View style={s.chipRow}>
                {[128, 256, 512, 1024, 2048, 4096].map(value => (
                  <Chip key={value} label={String(value)} selected={settings.batchSize === value} onPress={() => {
                    setSettings(current => ({...current, batchSize: value, ubatchSize: Math.min(current.ubatchSize, value)}));
                  }} />
                ))}
              </View>
              <Text style={[s.settingName, s.settingGap]}>Micro-batch: {settings.ubatchSize}</Text>
              <View style={s.chipRow}>
                {ubatchOptions.map(value => (
                  <Chip key={value} label={String(value)} selected={settings.ubatchSize === value} onPress={() => updateSetting('ubatchSize', value)} />
                ))}
              </View>
              <View style={s.switchRow}>
                <View style={s.switchCopy}>
                  <Text style={s.settingName}>Memory map (mmap)</Text>
                  <Text style={s.settingHint}>Recomendado para carregar modelos sem duplicar toda a leitura do arquivo.</Text>
                </View>
                <Switch value={settings.useMmap} onValueChange={value => updateSetting('useMmap', value)} />
              </View>
              <Text style={[s.settingName, s.settingGap]}>Cache KV</Text>
              <Text style={s.settingHint}>F16 prioriza compatibilidade; Q8_0 ou Q4_0 reduzem memória do contexto.</Text>
              <View style={s.chipRow}>
                {['f16', 'q8_0', 'q4_0'].map(value => (
                  <Chip key={value} label={value.toUpperCase()} selected={settings.cacheType === value} onPress={() => updateSetting('cacheType', value)} />
                ))}
              </View>
              <Text style={[s.settingName, s.settingGap]}>Flash Attention</Text>
              <View style={s.chipRow}>
                {['auto', 'off'].map(value => (
                  <Chip key={value} label={value === 'auto' ? 'Auto' : 'Desligado'} selected={settings.flashAttention === value} onPress={() => updateSetting('flashAttention', value)} />
                ))}
              </View>

              <Text style={s.sectionTitle}>GPU</Text>
              {gpuAvailable ? (
                <>
                  <Text style={s.settingName}>Camadas GPU: {settings.gpuLayers}</Text>
                  <Text style={s.settingHint}>Número de camadas do modelo transferidas para o backend de GPU.</Text>
                  <View style={s.chipRow}>
                    {[0, 4, 8, 16, 32, 64, 128].map(value => (
                      <Chip key={value} label={value === 0 ? 'CPU' : String(value)} selected={settings.gpuLayers === value} onPress={() => updateSetting('gpuLayers', value)} />
                    ))}
                  </View>
                </>
              ) : (
                <View style={s.gpuCard}>
                  <Text style={s.settingName}>Camadas GPU: 0 · CPU-only</Text>
                  <Text style={s.settingHint}>Este APK não inclui um backend GPU validado. OpenCL/Vulkan permanecem desligados; o offload não pode ser ativado neste build.</Text>
                </View>
              )}

              <Text style={s.sectionTitle}>GERAÇÃO</Text>
              <Text style={s.settingName}>Máximo de tokens: {settings.maxTokens}</Text>
              <View style={s.chipRow}>
                {[128, 256, 512, 1024, 2048, 4096].map(value => (
                  <Chip key={value} label={String(value)} selected={settings.maxTokens === value} onPress={() => updateSetting('maxTokens', value)} />
                ))}
              </View>
              <Text style={[s.settingName, s.settingGap]}>Temperatura: {settings.temperature.toFixed(1)}</Text>
              <View style={s.chipRow}>
                {[0.2, 0.5, 0.7, 1.0].map(value => (
                  <Chip key={value} label={value.toFixed(1)} selected={settings.temperature === value} onPress={() => updateSetting('temperature', value)} />
                ))}
              </View>
              <Text style={[s.settingName, s.settingGap]}>Top-k: {settings.topK}</Text>
              <View style={s.chipRow}>
                {[20, 40, 80, 0].map(value => (
                  <Chip key={value} label={value === 0 ? 'Off' : String(value)} selected={settings.topK === value} onPress={() => updateSetting('topK', value)} />
                ))}
              </View>
              <Text style={[s.settingName, s.settingGap]}>Top-p: {settings.topP.toFixed(2)}</Text>
              <View style={s.chipRow}>
                {[0.8, 0.9, 0.95, 1.0].map(value => (
                  <Chip key={value} label={value.toFixed(2)} selected={settings.topP === value} onPress={() => updateSetting('topP', value)} />
                ))}
              </View>
              <Text style={[s.settingName, s.settingGap]}>Penalidade de repetição: {settings.repeatPenalty.toFixed(2)}</Text>
              <View style={s.chipRow}>
                {[1.0, 1.05, 1.1, 1.15].map(value => (
                  <Chip key={value} label={value.toFixed(2)} selected={settings.repeatPenalty === value} onPress={() => updateSetting('repeatPenalty', value)} />
                ))}
              </View>

              {engineNeedsReload && (
                <View style={s.reloadNotice}>
                  <Text style={s.reloadText}>As opções de CPU, contexto e memória mudaram. Recarregue o modelo para aplicá-las.</Text>
                  <Pressable onPress={() => loadStoredModel(modelName)} disabled={busy} style={s.reloadButton}>
                    <Text style={s.reloadButtonText}>Aplicar e recarregar</Text>
                  </Pressable>
                </View>
              )}
              <Pressable onPress={clearConversation} disabled={busy} style={[s.clearButton, busy && s.disabled]}>
                <Text style={s.clearButtonText}>Limpar conversa</Text>
              </Pressable>
              <Pressable onPress={() => setSettingsOpen(false)} style={s.doneButton}>
                <Text style={s.doneButtonText}>Concluir</Text>
              </Pressable>
              <Text style={s.footerNote}>As opções ficam salvas no aparelho. Threads, contexto, batch e cache são aplicados ao carregar o modelo. Temperatura, top-k, top-p e penalidade são aplicados na próxima mensagem.</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#FFFFFF'},
  header: {height: 66, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F1F5'},
  logo: {width: 40, height: 40, borderRadius: 14, backgroundColor: '#635BDB', alignItems: 'center', justifyContent: 'center'},
  logoText: {color: '#FFFFFF', fontSize: 22, fontWeight: '800'},
  brand: {marginLeft: 11, flex: 1},
  title: {fontSize: 17, fontWeight: '800', color: '#191B2B'},
  statusLine: {flexDirection: 'row', alignItems: 'center', marginTop: 3},
  subtitle: {fontSize: 11, color: '#858A9B'},
  dot: {width: 6, height: 6, borderRadius: 3, backgroundColor: '#B9BDCA', marginRight: 6},
  dotReady: {backgroundColor: '#36A77A'},
  menuButton: {width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F6FA'},
  menuGlyph: {fontSize: 19, color: '#50536A', fontWeight: '900', letterSpacing: 1},
  chatBar: {height: 44, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  chatTitle: {fontSize: 13, color: '#24263A', fontWeight: '800'},
  chatMeta: {fontSize: 10, color: '#969BAB', maxWidth: '72%'},
  messages: {paddingHorizontal: 16, paddingTop: 8, paddingBottom: 18},
  emptyList: {flexGrow: 1, justifyContent: 'center'},
  empty: {alignItems: 'center', paddingHorizontal: 34, paddingBottom: 32},
  emptyLogo: {width: 62, height: 62, borderRadius: 22, backgroundColor: '#F1F0FF', alignItems: 'center', justifyContent: 'center', marginBottom: 17},
  emptyQ: {fontSize: 34, fontWeight: '800', color: '#635BDB'},
  emptyTitle: {fontSize: 19, fontWeight: '800', color: '#23253A', textAlign: 'center'},
  emptyText: {fontSize: 13, lineHeight: 20, color: '#8B90A1', textAlign: 'center', marginTop: 8},
  emptyButton: {marginTop: 18, backgroundColor: '#635BDB', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12},
  emptyButtonText: {color: '#FFFFFF', fontSize: 12, fontWeight: '800'},
  messageRow: {width: '100%', marginVertical: 8},
  userRow: {alignItems: 'flex-end'},
  assistantRow: {alignItems: 'flex-start'},
  assistantMessageRow: {paddingHorizontal: 4, paddingVertical: 2},
  bubble: {maxWidth: '90%', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 17},
  userBubble: {backgroundColor: '#635BDB', borderBottomRightRadius: 5},
  message: {fontSize: 14, lineHeight: 22, color: '#292B3F'},
  assistantMessage: {flexShrink: 1, paddingHorizontal: 2, color: '#292B3F'},
  userMessage: {color: '#FFFFFF'},
  errorMessage: {color: '#A43E35'},
  messageError: {fontSize: 12, lineHeight: 18, color: '#A43E35', marginTop: 5},
  thinkingContainer: {width: '100%', backgroundColor: '#F7F7FB', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 9},
  thinkingToggle: {flexDirection: 'row', alignItems: 'center', minHeight: 22},
  thinkingChevron: {fontSize: 17, lineHeight: 19, color: '#827DBA', marginRight: 8, width: 12},
  thinkingTitle: {fontSize: 12, fontWeight: '700', color: '#77739F', flex: 1},
  thinkingText: {fontSize: 12, lineHeight: 18, color: '#777B8B', marginTop: 8},
  streamStatus: {flexDirection: 'row', alignItems: 'center', marginTop: 6},
  streamText: {fontSize: 10, color: '#898DA0', marginLeft: 6},
  composerDock: {width: '100%'},
  newChatButton: {width: 34, height: 34, borderRadius: 11, backgroundColor: '#F1F0FF', alignItems: 'center', justifyContent: 'center', marginLeft: 8},
  newChatGlyph: {fontSize: 22, color: '#635BDB', lineHeight: 26},
  liveDot: {color: '#20C879', marginLeft: 4, includeFontPadding: false},
  composer: {marginHorizontal: 14, marginTop: 7, marginBottom: 5, borderWidth: 1, borderColor: '#E8E9F0', borderRadius: 18, padding: 7, flexDirection: 'row', alignItems: 'flex-end'},
  input: {flex: 1, maxHeight: 116, minHeight: 42, paddingHorizontal: 10, paddingTop: 11, paddingBottom: 9, color: '#25273A', fontSize: 14},
  send: {height: 42, width: 44, borderRadius: 13, backgroundColor: '#635BDB', alignItems: 'center', justifyContent: 'center'},
  sendDisabled: {backgroundColor: '#C5C4D9'},
  sendGlyph: {color: '#FFFFFF', fontSize: 25, lineHeight: 29, fontWeight: '500'},
  pressed: {opacity: 0.82, transform: [{scale: 0.98}]},
  modalBackdrop: {flex: 1, backgroundColor: 'rgba(18, 19, 35, 0.30)', justifyContent: 'flex-end'},
  backdropDismiss: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  menuSheet: {height: '92%', maxHeight: '92%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 24},
  settingsScroll: {flex: 1, minHeight: 0},
  settingsScrollContent: {paddingBottom: 40, flexGrow: 1},
  menuChoiceSheet: {height: 'auto', maxHeight: '55%'},
  menuOption: {minHeight: 70, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F0F1F5'},
  menuOptionIcon: {width: 42, height: 42, borderRadius: 13, backgroundColor: '#F1F0FF', alignItems: 'center', justifyContent: 'center'},
  menuOptionGlyph: {fontSize: 19, color: '#635BDB'},
  menuOptionCopy: {flex: 1, paddingHorizontal: 12},
  menuOptionTitle: {fontSize: 14, fontWeight: '800', color: '#27293D'},
  menuOptionHint: {fontSize: 11, color: '#858A9B', marginTop: 4},
  menuOptionArrow: {fontSize: 25, color: '#A0A4B1'},
  sheetHandle: {alignSelf: 'center', width: 38, height: 4, borderRadius: 4, backgroundColor: '#DFE0E8', marginTop: 10, marginBottom: 17},
  sheetHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18},
  sheetTitle: {fontSize: 20, fontWeight: '800', color: '#202238'},
  sheetSubtitle: {fontSize: 12, color: '#8B90A1', marginTop: 3},
  closeButton: {width: 34, height: 34, borderRadius: 12, backgroundColor: '#F5F5F8', alignItems: 'center', justifyContent: 'center'},
  closeGlyph: {fontSize: 25, color: '#62667A', lineHeight: 28},
  sectionTitle: {fontSize: 10, fontWeight: '900', color: '#9297A8', letterSpacing: 1.1, marginTop: 18, marginBottom: 10},
  settingName: {fontSize: 13, fontWeight: '700', color: '#27293D'},
  settingHint: {fontSize: 11, lineHeight: 16, color: '#858A9B', marginTop: 4},
  importButton: {backgroundColor: '#635BDB', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 13},
  importGlyph: {color: '#FFFFFF', fontSize: 20, marginRight: 7},
  importButtonText: {color: '#FFFFFF', fontSize: 12, fontWeight: '800'},
  emptyModels: {fontSize: 12, color: '#9A9EAC', paddingVertical: 14, textAlign: 'center'},
  modelItem: {flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F1F5'},
  modelItemCopy: {flex: 1, paddingRight: 8},
  modelItemName: {fontSize: 12, fontWeight: '700', color: '#27293D'},
  modelLoadButton: {backgroundColor: '#EFEEFF', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8},
  modelLoadText: {fontSize: 10, color: '#5D55CA', fontWeight: '800'},
  modelUnloadButton: {backgroundColor: '#F1F0FF'},
  modelUnloadText: {color: '#7168D9'},
  deleteModelButton: {width: 30, height: 30, borderRadius: 9, backgroundColor: '#F7F7FA', marginLeft: 7, alignItems: 'center', justifyContent: 'center'},
  deleteModelText: {fontSize: 20, color: '#8C91A1', lineHeight: 22},
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', marginTop: 9, marginBottom: 4},
  chip: {paddingHorizontal: 13, paddingVertical: 9, borderRadius: 11, backgroundColor: '#F3F4F8', marginRight: 8, marginBottom: 5},
  chipSelected: {backgroundColor: '#EFEEFF', borderWidth: 1, borderColor: '#C9C5FF'},
  chipText: {fontSize: 11, fontWeight: '700', color: '#73788B'},
  chipTextSelected: {color: '#5D55CA'},
  settingGap: {marginTop: 14},
  switchRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingVertical: 8},
  switchCopy: {flex: 1, paddingRight: 14},
  gpuCard: {padding: 13, backgroundColor: '#F7F7FA', borderRadius: 13},
  reloadNotice: {marginTop: 18, padding: 13, backgroundColor: '#F4F3FF', borderRadius: 13},
  reloadText: {fontSize: 11, lineHeight: 16, color: '#625BC8'},
  reloadButton: {alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: '#635BDB'},
  reloadButtonText: {fontSize: 11, fontWeight: '800', color: '#FFFFFF'},
  clearButton: {alignItems: 'center', paddingVertical: 13, borderRadius: 12, marginTop: 20, backgroundColor: '#F7F7FA'},
  clearButtonText: {fontSize: 12, fontWeight: '700', color: '#72778A'},
  doneButton: {alignItems: 'center', paddingVertical: 14, borderRadius: 13, marginTop: 9, backgroundColor: '#635BDB'},
  doneButtonText: {fontSize: 13, fontWeight: '800', color: '#FFFFFF'},
  footerNote: {fontSize: 10, lineHeight: 15, color: '#A0A4B1', textAlign: 'center', marginTop: 11, marginBottom: 7},
  disabled: {opacity: 0.5},
});
