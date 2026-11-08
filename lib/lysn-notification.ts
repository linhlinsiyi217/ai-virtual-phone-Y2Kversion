import {loadLysn} from './lysn-storage';
import {loadCharacters} from './character-storage';
let lastSoundAt=0;
export function notifyLysn(id:string){const s=loadLysn();if(!s.subscribedIds.includes(id)||!s.settings.notificationsEnabled||s.rooms[id]?.muted)return;const name=s.rooms[id]?.chatName?.trim()||s.profiles[id]?.name?.trim()||loadCharacters().find(c=>c.id===id)?.name||'艺人';const title=`Lysn 有[${name}]消息`;window.dispatchEvent(new CustomEvent('lysn-message-notice',{detail:{characterId:id,title,body:'点击查看'}}));if(!document.hidden&&s.settings.notificationSound&&Date.now()-lastSoundAt>10000){lastSoundAt=Date.now();void new Audio(s.settings.notificationSound).play().catch(()=>{});}}
