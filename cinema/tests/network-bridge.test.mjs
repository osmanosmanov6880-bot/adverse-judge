import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
const data=readFileSync(new URL('../src/data.js',import.meta.url),'utf8');
test('cinema has a genuine epilogue before an independent network exit',()=>{
 assert.match(data,/id:'scene_015'/);
 const maker=app.slice(app.indexOf('function networkContinuation(){'),app.indexOf('function render(){'));
 assert.match(maker,/createElement|el\('aside'/);
 assert.match(maker,/link\.href='https:\/\/marcosa\.club\/'/);
 assert.match(maker,/link\.rel='noopener noreferrer'/);
 assert.match(maker,/link\.target='_blank'/);
 assert.match(maker,/Никакой текст дела, выбор или личные данные не отправляются туда автоматически/);
 const renderer=app.slice(app.indexOf('function render(){'),app.indexOf('function handleChoice('));
 assert.match(renderer,/if\(scene\.id==='scene_015'\)zone\.appendChild\(networkContinuation\(\)\)/);
 assert.ok(renderer.indexOf("if(scene.id==='scene_015')")>renderer.indexOf('zone.appendChild(choices)'));
});
test('keeps own dossier transfers and never passes user data to MARCOSA link',()=>{
 const maker=app.slice(app.indexOf('function networkContinuation(){'),app.indexOf('function render(){'));
 assert.ok(!/state\.|localStorage|sessionStorage|userId|fetch\(|sendBeacon|URLSearchParams|utm_/.test(maker));
 assert.ok(app.includes("function openTransfer()"),'existing consented handoff is still present');
 assert.match(css,/\.marcosa-ending-continuation/);
 assert.match(css,/\.marcosa-ending-link:focus-visible/);
});
