import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, KeyboardAvoidingView, NativeModules, Platform, Pressable, StatusBar, StyleSheet, Text, TextInput, View} from 'react-native';
const Native = NativeModules.QuazyNative;

export default function App() {
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState('Escolha um modelo GGUF para começar.');
  const [modelReady, setModelReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tokenStats, setTokenStats] = useState('Prompt 0 · Gerados 0');
  const listRef = useRef(null);

  useEffect(() => () => { try { Native?.releaseModel?.(); } catch (_) {} }, []);

  const chooseModel = async () => {
    if (!Native) { setStatus('Módulo nativo indisponível nesta compilação.'); return; }
    setBusy(true);
    setStatus('Abrindo arquivos do dispositivo…');
    try {
      const result = await Native.pickAndLoadModel();
      if (result === 'CANCELLED') setStatus('Seleção cancelada.');
      else if (typeof result === 'string' && result.startsWith('OK:')) {
        setModelReady(true);
        setStatus(result.slice(3).trim());
        setMessages(current => current.length ? current : [{id:'welcome',role:'assistant',text:'Modelo pronto. Suas mensagens são processadas localmente neste aparelho.'}]);
      } else {
        setModelReady(false);
        setStatus((result || 'Não foi possível carregar este modelo.').replace(/^ERROR:/, ''));
      }
    } catch (error) {
      setModelReady(false);
      setStatus(error?.message || 'Falha ao abrir ou carregar o modelo.');
    } finally { setBusy(false); }
  };

  const sendMessage = async () => {
    const text = prompt.trim();
    if (!text || !modelReady || busy) return;
    setPrompt('');
    setMessages(current => [...current, {id:String(Date.now()),role:'user',text}]);
    setBusy(true);
    setStatus('Gerando resposta localmente…');
    try {
      const result = await Native.generate(text, 256);
      setMessages(current => [...current, {id:String(Date.now()+1),role:'assistant',text:result?.answer || 'O modelo não retornou texto.'}]);
      setTokenStats(result?.stats || 'Contagem de tokens indisponível');
      setStatus('Pronto · inferência local');
    } catch (error) {
      setMessages(current => [...current, {id:String(Date.now()+1),role:'assistant',text:'Falha na geração: ' + (error?.message || 'erro nativo')}]);
      setStatus('A geração foi interrompida.');
    } finally { setBusy(false); }
  };

  const renderMessage = ({item}) => {
    const user = item.role === 'user';
    return <View style={[s.messageRow,user?s.userRow:s.assistantRow]}>
      <View style={[s.bubble,user?s.userBubble:s.assistantBubble]}>
        <Text style={s.author}>{user?'Você':'Quazy AI'}</Text>
        <Text style={[s.message,user&&s.userMessage]}>{item.text}</Text>
      </View>
    </View>;
  };

  return <View style={s.screen}>
    <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
    <View style={s.header}>
      <View style={s.logo}><Text style={s.logoText}>Q</Text></View>
      <View style={s.brand}><Text style={s.title}>Quazy AI</Text><Text style={s.subtitle}>Seu assistente local</Text></View>
      <View style={s.badge}><View style={s.dot}/><Text style={s.badgeText}>NO DISPOSITIVO</Text></View>
    </View>
    <View style={s.modelCard}>
      <View style={s.modelText}><Text style={s.eyebrow}>MODELO ATIVO</Text><Text style={s.modelName}>{modelReady?'Modelo GGUF carregado':'Nenhum modelo carregado'}</Text><Text style={s.hint}>{status}</Text></View>
      <Pressable onPress={chooseModel} disabled={busy} style={({pressed})=>[s.modelButton,pressed&&s.pressed,busy&&s.disabled]}>
        {busy?<ActivityIndicator color="#FFF"/>:<Text style={s.buttonText}>Escolher GGUF</Text>}
      </Pressable>
    </View>
    <View style={s.chatHeader}><Text style={s.chatTitle}>Conversa</Text><Text style={s.tokens}>{tokenStats}</Text></View>
    <FlatList ref={listRef} data={messages} keyExtractor={item=>item.id} renderItem={renderMessage}
      contentContainerStyle={[s.messages,messages.length===0&&s.emptyList]} keyboardShouldPersistTaps="handled"
      onContentSizeChange={()=>listRef.current?.scrollToEnd({animated:true})}
      ListEmptyComponent={<View style={s.empty}>
        <View style={s.emptyLogo}><Text style={s.emptyQ}>Q</Text></View>
        <Text style={s.emptyTitle}>O que vamos descobrir?</Text>
        <Text style={s.emptyText}>Carregue um modelo GGUF e converse com sua IA. Tudo é processado no próprio aparelho.</Text>
      </View>}
    />
    <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}>
      <View style={s.composer}>
        <TextInput value={prompt} onChangeText={setPrompt} placeholder={modelReady?'Escreva sua mensagem…':'Carregue um modelo para conversar'}
          placeholderTextColor="#9AA1B2" style={s.input} multiline maxLength={6000} editable={modelReady&&!busy}
          returnKeyType="send" blurOnSubmit={false} onSubmitEditing={sendMessage}/>
        <Pressable onPress={sendMessage} disabled={!modelReady||!prompt.trim()||busy}
          style={({pressed})=>[s.send,(!modelReady||!prompt.trim()||busy)&&s.sendDisabled,pressed&&s.pressed]}>
          {busy?<ActivityIndicator color="#FFF"/>:<Text style={s.buttonText}>Enviar</Text>}
        </Pressable>
      </View>
      <Text style={s.privacy}>Suas conversas ficam no aparelho · llama.cpp</Text>
    </KeyboardAvoidingView>
  </View>;
}

const s = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#FFF',paddingTop:Platform.OS==='android'?(StatusBar.currentHeight||0):0},
  header:{height:76,paddingHorizontal:20,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:'#F0F1F5'},
  logo:{width:42,height:42,borderRadius:14,backgroundColor:'#635BDB',alignItems:'center',justifyContent:'center'},
  logoText:{color:'#FFF',fontSize:23,fontWeight:'800'},
  brand:{marginLeft:11,flex:1},title:{fontSize:18,fontWeight:'800',color:'#191B2B'},subtitle:{fontSize:12,color:'#858A9B',marginTop:2},
  badge:{flexDirection:'row',alignItems:'center',backgroundColor:'#F2F1FF',paddingHorizontal:10,paddingVertical:7,borderRadius:20},
  dot:{width:6,height:6,borderRadius:3,backgroundColor:'#36A77A',marginRight:6},badgeText:{fontSize:9,letterSpacing:.5,fontWeight:'800',color:'#625BC8'},
  modelCard:{marginHorizontal:18,marginTop:16,padding:15,borderRadius:18,backgroundColor:'#F8F8FC',borderWidth:1,borderColor:'#EEEEF5',flexDirection:'row',alignItems:'center'},
  modelText:{flex:1,paddingRight:10},eyebrow:{fontSize:9,fontWeight:'800',letterSpacing:1,color:'#8D91A2',marginBottom:5},
  modelName:{fontSize:14,fontWeight:'700',color:'#222438'},hint:{fontSize:11,color:'#777E91',marginTop:5,lineHeight:16},
  modelButton:{backgroundColor:'#635BDB',paddingHorizontal:13,paddingVertical:11,borderRadius:12,minWidth:112,alignItems:'center'},
  buttonText:{color:'#FFF',fontSize:11,fontWeight:'800'},pressed:{opacity:.82,transform:[{scale:.98}]},disabled:{opacity:.65},
  chatHeader:{paddingHorizontal:21,paddingTop:22,paddingBottom:9,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  chatTitle:{fontSize:15,color:'#24263A',fontWeight:'800'},tokens:{fontSize:10,color:'#969BAB'},
  messages:{paddingHorizontal:17,paddingTop:9,paddingBottom:16},emptyList:{flexGrow:1,justifyContent:'center'},
  empty:{alignItems:'center',paddingHorizontal:34,paddingBottom:24},emptyLogo:{width:64,height:64,borderRadius:22,backgroundColor:'#F1F0FF',alignItems:'center',justifyContent:'center',marginBottom:18},
  emptyQ:{fontSize:35,fontWeight:'800',color:'#635BDB'},emptyTitle:{fontSize:20,fontWeight:'800',color:'#23253A',textAlign:'center'},
  emptyText:{fontSize:13,lineHeight:20,color:'#8B90A1',textAlign:'center',marginTop:9},
  messageRow:{width:'100%',marginVertical:6},userRow:{alignItems:'flex-end'},assistantRow:{alignItems:'flex-start'},
  bubble:{maxWidth:'88%',paddingHorizontal:14,paddingVertical:11,borderRadius:17},userBubble:{backgroundColor:'#635BDB',borderBottomRightRadius:5},
  assistantBubble:{backgroundColor:'#F4F5F9',borderBottomLeftRadius:5},author:{fontSize:10,color:'#A0A4B3',fontWeight:'800',marginBottom:5},
  message:{fontSize:14,lineHeight:21,color:'#292B3F'},userMessage:{color:'#FFF'},
  composer:{marginHorizontal:15,marginTop:8,marginBottom:6,borderWidth:1,borderColor:'#E8E9F0',borderRadius:18,padding:8,flexDirection:'row',alignItems:'flex-end'},
  input:{flex:1,maxHeight:116,minHeight:42,paddingHorizontal:10,paddingTop:11,paddingBottom:9,color:'#25273A',fontSize:14},
  send:{height:42,minWidth:69,borderRadius:13,backgroundColor:'#635BDB',alignItems:'center',justifyContent:'center',paddingHorizontal:12},
  sendDisabled:{backgroundColor:'#C5C4D9'},privacy:{textAlign:'center',fontSize:10,color:'#A4A8B4',paddingBottom:9,paddingTop:2},
});
