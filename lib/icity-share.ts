import {loadCity,cityEntries,canShareCity,cityShareText} from './icity-store';
import {createOrGetSession,pushChatMessage} from './chat-storage';
import {activeReverse} from './reverse-phone-state';
import {CHAT_OPEN_SESSION_EVENT} from './chat-notification-events';
export function shareCityDiaryToChat(entryId:string,recipient:string){
 if(activeReverse())throw Error('反查期间不能分享日记');
 const city=loadCity(),entry=cityEntries(city).find(e=>e.id===entryId);
 if(!entry||!canShareCity(city,entry,recipient))throw Error('这篇日记不能分享给该角色');
 const session=createOrGetSession(recipient);if(!session)throw Error('找不到聊天对象');
 const text=cityShareText(city,entry,recipient);
 const message=pushChatMessage({sessionId:session.id,role:'user',content:text,mediaType:'app_card',mediaData:{appName:'iCity',appCardTitle:entry.title||'分享日记',appCardBody:entry.text.slice(0,160),cityDiarySnapshot:{title:entry.title,text:entry.text,handle:city.accounts.find(a=>a.id===entry.author)?.handle||'diary',photos:entry.photos},appCardSummary:'@'+(city.accounts.find(a=>a.id===entry.author)?.handle||'diary'),appHistoryText:text}});
 window.dispatchEvent(new CustomEvent('chat-messages-updated',{detail:{sessionId:session.id}}));
 window.dispatchEvent(new CustomEvent('open-mini-chat'));
 window.setTimeout(()=>window.dispatchEvent(new CustomEvent(CHAT_OPEN_SESSION_EVENT,{detail:{sessionId:session.id}})),150);
 return message;
}
