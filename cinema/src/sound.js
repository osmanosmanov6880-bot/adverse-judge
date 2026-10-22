(function(root,factory){root.CINEMA_SOUND=factory();})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
let ctx=null,master=null,drone=null,drone2=null,filter=null,enabled=false,volume=.25;
const ACC={low:48,hall:54,warm:62,archive:58,city:65,quiet:42};
function init(){
 const AC=window.AudioContext||window.webkitAudioContext;
 if(!AC)return false;
 if(ctx)return true;
 try{
 ctx=new AC();master=ctx.createGain();master.gain.value=0;master.connect(ctx.destination);
 filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=310;filter.Q.value=.28;filter.connect(master);
 drone=ctx.createOscillator();drone.type='sine';drone.frequency.value=48;drone.connect(filter);drone.start();
 drone2=ctx.createOscillator();drone2.type='triangle';drone2.frequency.value=73;
 const layer=ctx.createGain();layer.gain.value=.17;drone2.connect(layer);layer.connect(filter);drone2.start();return true;
 }catch(e){ctx=null;return false;}
}
function setEnabled(x){
 if(x&&!init())return false;
 enabled=!!x;
 if(ctx){if(enabled)ctx.resume().catch(()=>{});master.gain.setTargetAtTime(enabled?volume*.20:0,ctx.currentTime,.25);}
 return enabled;
}
function setVolume(v){volume=Math.max(0,Math.min(1,Number(v)||0));if(master&&ctx)master.gain.setTargetAtTime(enabled?volume*.20:0,ctx.currentTime,.06);}
function ambience(mood){if(!ctx||!enabled)return;const hz=ACC[mood]||50;drone.frequency.setTargetAtTime(hz,ctx.currentTime,1.3);drone2.frequency.setTargetAtTime(hz*1.499,ctx.currentTime,1.5);filter.frequency.setTargetAtTime(mood==='quiet'?170:420,ctx.currentTime,.8);}
function cue(type){
 if(!ctx||!enabled)return;
 const freq={arrival:242,gate:185,door:322,case:140,objection:112,defense:383,archive:290,decision:160,choice:440,impact:177,witness:225,reveal:91,rewrite:450,verdict:550,finale:660}[type]||280;
 const o=ctx.createOscillator(),g=ctx.createGain();o.type=type==='objection'?'triangle':'sine';
 o.frequency.setValueAtTime(freq,ctx.currentTime);o.frequency.exponentialRampToValueAtTime(freq*1.12,ctx.currentTime+.3);
 g.gain.setValueAtTime(.0001,ctx.currentTime);g.gain.exponentialRampToValueAtTime(Math.max(.002,volume*.06),ctx.currentTime+.028);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.65);
 o.connect(g);g.connect(master);o.start();o.stop(ctx.currentTime+.7);
}
function stop(){enabled=false;if(master&&ctx)master.gain.setTargetAtTime(0,ctx.currentTime,.2);}
return {setEnabled,setVolume,ambience,cue,stop,isEnabled:()=>enabled,getVolume:()=>volume};
});
