import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
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
  Text,
  TextInput,
  View,
} from 'react-native';

const Native = NativeModules.QuazyNative;

export default function App() {
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState('Carregue um modelo GGUF para começar.');
  const [modelReady, setModelReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [maxTokens, setMaxTokens] = useState(128);
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [tokenStats, setTokenStats] = useState('');
  const listRef = useRef(null);
  const activeRequest = useRef(null);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('QuazyToken', event => {
      const active = activeRequest.current;
      if (!active || event?.requestId !== active.requestId || typeof event?.text !== 'string') return;
      setMessages(current => current.map(item =>
        item.id === active.messageId ? {...item, text: event.text, streaming: true} : item,
      ));
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => () => {
    try { Native?.releaseModel?.(); } catch (_) {}
  }, []);

  const chooseModel = async () => {
    if (!Native) {
      setStatus('Módulo nativo indisponível nesta compilação.');
      return;
    }
    setSettingsOpen(false);
    setBusy(true);
    setStatus('Abrindo arquivo e carregando o modelo…');
    try {
      const result = await Native.pickAndLoadModel();
      if (result === 'CANCELLED') {
        setStatus('Seleção cancelada.');
      } else if (typeof result === 'string' && result.startsWith('OK:')) {
        setModelReady(true);
        setStatus(result.slice(3).trim());
        setMessages(current => current.length ? current : [{
          id: 'welcome',
          role: 'assistant',
          text: 'Modelo pronto. Suas mensagens são processadas localmente neste aparelho.',
        }]);
      } else {
        setModelReady(false);
        setStatus((result || 'Não foi possível carregar este modelo.').replace(/^ERROR:/, ''));
      }
    } catch (error) {
      setModelReady(false);
      setStatus(error?.message || 'Falha ao abrir ou carregar o modelo.');
    } finally {
      setBusy(false);
    }
  };

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
      {id: messageId, role: 'assistant', text: '', streaming: true},
    ]);
    activeRequest.current = {requestId, messageId};
    setBusy(true);
    setStatus('Gerando resposta no aparelho…');

    try {
      const result = await Native.generate(text, maxTokens, temperature, topP, requestId);
      const answer = typeof result?.answer === 'string' ? result.answer.trim() : '';
      setMessages(current => current.map(item =>
        item.id === messageId
          ? {...item, text: answer || item.text || 'O modelo terminou sem retornar texto.', streaming: false}
          : item,
      ));
      setTokenStats(result?.stats || '');
      setStatus('Pronto · inferência local');
    } catch (error) {
      const reason = error?.message || 'erro nativo desconhecido';
      setMessages(current => current.map(item =>
        item.id === messageId
          ? {...item, text: 'Não foi possível gerar a resposta. ' + reason, streaming: false, error: true}
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
    setTokenStats('');
    setSettingsOpen(false);
  };

  const Chip = ({label, selected, onPress}) => (
    <Pressable onPress={onPress} style={[s.chip, selected && s.chipSelected]}>
      <Text style={[s.chipText, selected && s.chipTextSelected]}>{label}</Text>
    </Pressable>
  );

  const renderMessage = ({item}) => {
    const user = item.role === 'user';
    return (
      <View style={[s.messageRow, user ? s.userRow : s.assistantRow]}>
        <View style={[s.bubble, user ? s.userBubble : s.assistantBubble, item.error && s.errorBubble]}>
          {!user && <Text style={s.author}>QUAZY AI</Text>}
          <Text style={[s.message, user && s.userMessage, item.error && s.errorMessage]}>
            {item.text || (item.streaming ? '' : ' ')}
          </Text>
          {item.streaming && (
            <View style={s.streamStatus}>
              {!item.text && <ActivityIndicator size="small" color="#7168D9" />}
              <Text style={s.streamText}>{item.text ? 'Gerando…' : 'Pensando…'}</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

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
        <Pressable onPress={() => setSettingsOpen(true)} style={s.menuButton} accessibilityLabel="Abrir configurações">
          <Text style={s.menuGlyph}>•••</Text>
        </Pressable>
      </View>

      <View style={s.chatBar}>
        <Text style={s.chatTitle}>Conversa</Text>
        <Text style={s.chatMeta}>{busy ? 'Gerando resposta' : tokenStats || (modelReady ? 'No dispositivo' : 'Offline')}</Text>
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
                : 'Abra o menu para escolher um modelo GGUF e conversar com sua IA local.'}
            </Text>
            {!modelReady && (
              <Pressable onPress={() => setSettingsOpen(true)} style={s.emptyButton}>
                <Text style={s.emptyButtonText}>Configurar modelo</Text>
              </Pressable>
            )}
          </View>
        }
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
        <Text style={s.privacy}>Processamento local · llama.cpp</Text>
      </KeyboardAvoidingView>

      <Modal visible={settingsOpen} transparent animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setSettingsOpen(false)}>
          <Pressable style={s.menuSheet} onPress={() => {}}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <View>
                <Text style={s.sheetTitle}>Configurações</Text>
                <Text style={s.sheetSubtitle}>Modelo e geração local</Text>
              </View>
              <Pressable onPress={() => setSettingsOpen(false)} style={s.closeButton}>
                <Text style={s.closeGlyph}>×</Text>
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={s.sectionTitle}>MODELO</Text>
              <View style={s.modelSetting}>
                <View style={s.modelSettingCopy}>
                  <Text style={s.settingName}>{modelReady ? 'Modelo carregado' : 'Nenhum modelo selecionado'}</Text>
                  <Text style={s.settingHint}>{modelReady ? status : 'Selecione um arquivo .gguf do aparelho.'}</Text>
                </View>
                <Pressable onPress={chooseModel} disabled={busy} style={[s.secondaryButton, busy && s.disabled]}>
                  <Text style={s.secondaryButtonText}>{modelReady ? 'Trocar' : 'Escolher'}</Text>
                </Pressable>
              </View>

              <Text style={s.sectionTitle}>GERAÇÃO</Text>
              <Text style={s.settingName}>Tamanho da resposta</Text>
              <Text style={s.settingHint}>Limite de tokens por mensagem. Valores menores respondem mais rápido.</Text>
              <View style={s.chipRow}>
                {[64, 128, 256].map(value => (
                  <Chip key={value} label={value + ' tokens'} selected={maxTokens === value} onPress={() => setMaxTokens(value)} />
                ))}
              </View>

              <Text style={[s.settingName, s.settingGap]}>Criatividade</Text>
              <Text style={s.settingHint}>Temperatura mais alta aumenta a variedade das respostas.</Text>
              <View style={s.chipRow}>
                {[0.3, 0.7, 1.0].map(value => (
                  <Chip key={value} label={String(value.toFixed(1))} selected={temperature === value} onPress={() => setTemperature(value)} />
                ))}
              </View>

              <Text style={[s.settingName, s.settingGap]}>Top-p</Text>
              <Text style={s.settingHint}>Controla a seleção entre os tokens mais prováveis.</Text>
              <View style={s.chipRow}>
                {[0.8, 0.9, 0.95].map(value => (
                  <Chip key={value} label={String(value)} selected={topP === value} onPress={() => setTopP(value)} />
                ))}
              </View>

              <Pressable onPress={clearConversation} disabled={busy} style={[s.clearButton, busy && s.disabled]}>
                <Text style={s.clearButtonText}>Limpar conversa</Text>
              </Pressable>
              <Pressable onPress={() => setSettingsOpen(false)} style={s.doneButton}>
                <Text style={s.doneButtonText}>Concluir</Text>
              </Pressable>
              <Text style={s.footerNote}>As alterações de geração são aplicadas na próxima mensagem. O modelo permanece no aparelho.</Text>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#FFFFFF', paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0},
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
  chatMeta: {fontSize: 10, color: '#969BAB', maxWidth: '70%'},
  messages: {paddingHorizontal: 16, paddingTop: 8, paddingBottom: 18},
  emptyList: {flexGrow: 1, justifyContent: 'center'},
  empty: {alignItems: 'center', paddingHorizontal: 34, paddingBottom: 32},
  emptyLogo: {width: 62, height: 62, borderRadius: 22, backgroundColor: '#F1F0FF', alignItems: 'center', justifyContent: 'center', marginBottom: 17},
  emptyQ: {fontSize: 34, fontWeight: '800', color: '#635BDB'},
  emptyTitle: {fontSize: 19, fontWeight: '800', color: '#23253A', textAlign: 'center'},
  emptyText: {fontSize: 13, lineHeight: 20, color: '#8B90A1', textAlign: 'center', marginTop: 8},
  emptyButton: {marginTop: 18, backgroundColor: '#635BDB', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12},
  emptyButtonText: {color: '#FFFFFF', fontSize: 12, fontWeight: '800'},
  messageRow: {width: '100%', marginVertical: 6},
  userRow: {alignItems: 'flex-end'},
  assistantRow: {alignItems: 'flex-start'},
  bubble: {maxWidth: '90%', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 17},
  userBubble: {backgroundColor: '#635BDB', borderBottomRightRadius: 5},
  assistantBubble: {backgroundColor: '#F4F5F9', borderBottomLeftRadius: 5},
  errorBubble: {backgroundColor: '#FFF3F1'},
  author: {fontSize: 9, color: '#999EAE', fontWeight: '900', letterSpacing: 0.6, marginBottom: 5},
  message: {fontSize: 14, lineHeight: 21, color: '#292B3F'},
  userMessage: {color: '#FFFFFF'},
  errorMessage: {color: '#A43E35'},
  streamStatus: {flexDirection: 'row', alignItems: 'center', marginTop: 6},
  streamText: {fontSize: 10, color: '#898DA0', marginLeft: 6},
  composer: {marginHorizontal: 14, marginTop: 7, marginBottom: 5, borderWidth: 1, borderColor: '#E8E9F0', borderRadius: 18, padding: 7, flexDirection: 'row', alignItems: 'flex-end'},
  input: {flex: 1, maxHeight: 116, minHeight: 42, paddingHorizontal: 10, paddingTop: 11, paddingBottom: 9, color: '#25273A', fontSize: 14},
  send: {height: 42, width: 44, borderRadius: 13, backgroundColor: '#635BDB', alignItems: 'center', justifyContent: 'center'},
  sendDisabled: {backgroundColor: '#C5C4D9'},
  sendGlyph: {color: '#FFFFFF', fontSize: 25, lineHeight: 29, fontWeight: '500'},
  pressed: {opacity: 0.82, transform: [{scale: 0.98}]},
  privacy: {textAlign: 'center', fontSize: 10, color: '#A4A8B4', paddingBottom: 8, paddingTop: 2},
  modalBackdrop: {flex: 1, backgroundColor: 'rgba(18, 19, 35, 0.30)', justifyContent: 'flex-end'},
  menuSheet: {maxHeight: '88%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 28},
  sheetHandle: {alignSelf: 'center', width: 38, height: 4, borderRadius: 4, backgroundColor: '#DFE0E8', marginTop: 10, marginBottom: 17},
  sheetHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18},
  sheetTitle: {fontSize: 20, fontWeight: '800', color: '#202238'},
  sheetSubtitle: {fontSize: 12, color: '#8B90A1', marginTop: 3},
  closeButton: {width: 34, height: 34, borderRadius: 12, backgroundColor: '#F5F5F8', alignItems: 'center', justifyContent: 'center'},
  closeGlyph: {fontSize: 25, color: '#62667A', lineHeight: 28},
  sectionTitle: {fontSize: 10, fontWeight: '900', color: '#9297A8', letterSpacing: 1.1, marginTop: 13, marginBottom: 10},
  modelSetting: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F8FC', borderRadius: 15, padding: 13, marginBottom: 7},
  modelSettingCopy: {flex: 1, paddingRight: 9},
  settingName: {fontSize: 13, fontWeight: '700', color: '#27293D'},
  settingHint: {fontSize: 11, lineHeight: 16, color: '#858A9B', marginTop: 4},
  secondaryButton: {backgroundColor: '#635BDB', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10},
  secondaryButtonText: {fontSize: 11, fontWeight: '800', color: '#FFFFFF'},
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', marginTop: 9, marginBottom: 4},
  chip: {paddingHorizontal: 13, paddingVertical: 9, borderRadius: 11, backgroundColor: '#F3F4F8', marginRight: 8, marginBottom: 5},
  chipSelected: {backgroundColor: '#EFEEFF', borderWidth: 1, borderColor: '#C9C5FF'},
  chipText: {fontSize: 11, fontWeight: '700', color: '#73788B'},
  chipTextSelected: {color: '#5D55CA'},
  settingGap: {marginTop: 14},
  clearButton: {alignItems: 'center', paddingVertical: 13, borderRadius: 12, marginTop: 20, backgroundColor: '#F7F7FA'},
  clearButtonText: {fontSize: 12, fontWeight: '700', color: '#72778A'},
  doneButton: {alignItems: 'center', paddingVertical: 14, borderRadius: 13, marginTop: 9, backgroundColor: '#635BDB'},
  doneButtonText: {fontSize: 13, fontWeight: '800', color: '#FFFFFF'},
  footerNote: {fontSize: 10, lineHeight: 15, color: '#A0A4B1', textAlign: 'center', marginTop: 11, marginBottom: 7},
  disabled: {opacity: 0.55},
});
