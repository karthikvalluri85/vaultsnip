var VSDesign=(function($){"use strict";function F(i){const t=String(i||"").trim();if(!t||t==="transparent"||t==="none")return null;const r=/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(t);if(r){const l=r[4]==null?1:r[4].endsWith("%")?parseFloat(r[4])/100:parseFloat(r[4]);return l>0?{color:"#"+[r[1],r[2],r[3]].map(v=>Math.max(0,Math.min(255,Math.round(+v))).toString(16).padStart(2,"0")).join(""),opacity:Math.min(1,l)}:null}return/^#[0-9a-f]{3,8}$/i.test(t)?{color:t.toLowerCase(),opacity:1}:null}const X=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\ufffe\uffff]/g,M=i=>String(i??"").replace(X,"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[t]),c=i=>Math.round(i*100)/100;function R(i,t="normal",r="none"){let l=/^pre/.test(t)?i:i.replace(/\s+/g," ");return r==="uppercase"?l=l.toUpperCase():r==="lowercase"&&(l=l.toLowerCase()),l}function O(i){const t=i.toLowerCase();return t==="central"||t==="middle"?.35:t==="hanging"||t==="text-before-edge"?.8:t==="text-after-edge"||t==="ideographic"?-.2:0}function z(i){return(String(i||"").normalize("NFKD").replace(/[^\w\s]/g," ").trim().split(/\s+/).filter(Boolean).slice(0,5).map(l=>l[0].toUpperCase()+l.slice(1).toLowerCase()).join("").replace(/^[^A-Za-z]+/,"")||"Dashboard")+"Replica"}const I=i=>!!i.classList&&i.classList.contains("rp-csv");function J(i,t={}){const r=i.getBoundingClientRect(),l=Math.ceil(r.width),x=Math.ceil(i.scrollHeight||r.height),v=o=>({x:c(o.left-r.left),y:c(o.top-r.top),w:c(o.width),h:c(o.height)}),A=[];let u=0;const f=[],k=o=>o?`fill="${o.color}"${o.opacity<1?` fill-opacity="${c(o.opacity)}"`:""}`:'fill="none"';function C(o){const e=getComputedStyle(o);if(e.display==="none"||e.visibility==="hidden"||I(o))return;const n=v(o.getBoundingClientRect()),g=parseFloat(e.opacity),h=[];if(g<1&&(f.push(`<g opacity="${c(g)}">`),h.push("</g>")),o instanceof SVGSVGElement||o.localName==="svg"){n.w>0&&n.h>0&&f.push(T(o,n)),f.push(...h.reverse());return}if(n.w>0&&n.h>0&&f.push(...E(e,n)),(e.overflow!=="visible"||e.overflowX!=="visible"||e.overflowY!=="visible")&&n.w>0&&n.h>0){const s="vs-clip-"+ ++u,b=Math.min(parseFloat(e.borderTopLeftRadius)||0,n.w/2,n.h/2);A.push(`<clipPath id="${s}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"${b?` rx="${c(b)}"`:""}/></clipPath>`),f.push(`<g clip-path="url(#${s})">`),h.push("</g>")}for(const s of Array.from(o.childNodes))s.nodeType===1?C(s):s.nodeType===3&&j(s,e);f.push(...h.reverse())}function E(o,e){const n=[],g=F(o.backgroundColor),h=Math.min(parseFloat(o.borderTopLeftRadius)||0,e.w/2,e.h/2),S=a=>({w:parseFloat(o.getPropertyValue(`border-${a.toLowerCase()}-width`))||0,p:o.getPropertyValue(`border-${a.toLowerCase()}-style`)==="none"?null:F(o.getPropertyValue(`border-${a.toLowerCase()}-color`))}),s={t:S("Top"),r:S("Right"),b:S("Bottom"),l:S("Left")},L=[s.t,s.r,s.b,s.l].every(a=>a.w===s.t.w&&a.p&&s.t.p&&a.p.color===s.t.p.color),V=h?` rx="${c(h)}"`:"";if(L&&s.t.w>0&&s.t.p){const a=s.t.w;return n.push(`<rect x="${c(e.x+a/2)}" y="${c(e.y+a/2)}" width="${c(Math.max(0,e.w-a))}" height="${c(Math.max(0,e.h-a))}"${V} ${k(g)} stroke="${s.t.p.color}"${s.t.p.opacity<1?` stroke-opacity="${c(s.t.p.opacity)}"`:""} stroke-width="${c(a)}"/>`),n}g&&n.push(`<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}"${V} ${k(g)}/>`);const D=(a,w,y,U,W)=>{W&&y>0&&U>0&&n.push(`<rect x="${c(a)}" y="${c(w)}" width="${c(y)}" height="${c(U)}" ${k(W)}/>`)};return D(e.x,e.y,e.w,s.t.w,s.t.p),D(e.x,e.y+e.h-s.b.w,e.w,s.b.w,s.b.p),D(e.x,e.y,s.l.w,e.h,s.l.p),D(e.x+e.w-s.r.w,e.y,s.r.w,e.h,s.r.p),n}function j(o,e){const n=o.textContent||"";if(!n.trim())return;const g=document.createRange();g.selectNodeContents(o);const h=Array.from(g.getClientRects()).filter(a=>a.width>0&&a.height>0);if(!h.length)return;const S=[];if(h.length===1)S.push({x:h[0].left,top:h[0].top,h:h[0].height,s:n});else{let a=null;for(let w=0;w<n.length;w++){g.setStart(o,w),g.setEnd(o,w+1);const y=g.getClientRects()[0];if(!y||!y.width&&/\s/.test(n[w])){a&&(a.s+=n[w]);continue}(!a||Math.abs(y.top-a.top)>y.height/2)&&(a={x:y.left,top:y.top,h:y.height,s:""},S.push(a)),a.s+=n[w]}}const s=parseFloat(e.fontSize)||14,b=F(e.color)||{color:"#000000",opacity:1},L=M(e.fontFamily.replace(/"/g,"'")),V=e.fontWeight&&e.fontWeight!=="400"&&e.fontWeight!=="normal"?` font-weight="${M(e.fontWeight)}"`:"",D=e.fontStyle==="italic"?' font-style="italic"':"";for(const a of S){const w=R(a.s,e.whiteSpace,e.textTransform).trim();if(!w)continue;const y=a.top-r.top+a.h/2+s*.35;f.push(`<text x="${c(a.x-r.left)}" y="${c(y)}" font-family="${L}" font-size="${c(s)}"${V}${D} ${k(b)} xml:space="preserve">${M(w)}</text>`)}}function T(o,e){const n=o.cloneNode(!0);n.getAttribute("viewBox")||n.setAttribute("viewBox",`0 0 ${e.w} ${e.h}`),n.setAttribute("x",String(e.x)),n.setAttribute("y",String(e.y)),n.setAttribute("width",String(e.w)),n.setAttribute("height",String(e.h)),n.removeAttribute("style"),n.removeAttribute("class");const g=getComputedStyle(o).fontFamily.replace(/"/g,"'");n.querySelectorAll("text").forEach(s=>{const b=s.getAttribute("style")||"";/font-family:\s*inherit/.test(b)?s.setAttribute("style",b.replace(/font-family:\s*inherit/,"font-family: "+g)):!/font-family/.test(b)&&!s.getAttribute("font-family")&&s.setAttribute("font-family",g);const L=s.getAttribute("dominant-baseline");if(!L)return;const V=parseFloat((/font-size:\s*([\d.]+)px/.exec(b)||[])[1]||s.getAttribute("font-size")||"12");s.removeAttribute("dominant-baseline"),s.setAttribute("y",String(c((parseFloat(s.getAttribute("y")||"0")||0)+O(L)*V)))});const h=++u;return new XMLSerializer().serializeToString(n).replace(/\bid="([^"]+)"/g,`id="$1-v${h}"`).replace(/url\(#([^)]+)\)/g,`url(#$1-v${h})`).replace(/href="#([^"]+)"/g,`href="#$1-v${h}"`)}C(i);const d=F(getComputedStyle(i).color)||{color:"#14181e"},p=[];for(let o=0;o<x;o+=200)for(let e=0;e<l;e+=340)p.push(`<text x="${e+170}" y="${o+108}" transform="rotate(-22 ${e+170} ${o+100})" text-anchor="middle">SYNTHETIC DATA</text>`);const m=M((t.title||"Dashboard replica")+" (synthetic data)");return`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${l}" height="${x}" viewBox="0 0 ${l} ${x}" data-synthetic="true">
<title>${m}</title>
<desc>Generated with VaultSnip. Every value is synthetic; this file contains no source data.</desc>
<defs><clipPath id="vs-page"><rect width="${l}" height="${x}" rx="10"/></clipPath>${A.join("")}</defs>
<g id="replica" clip-path="url(#vs-page)">
${f.join(`
`)}
</g>
<g id="watermark" fill="${d.color}" fill-opacity="0.07" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="3" clip-path="url(#vs-page)">${p.join("")}</g>
</svg>
`}const _=(()=>{const i=new Uint32Array(256);for(let t=0;t<256;t++){let r=t;for(let l=0;l<8;l++)r=r&1?3988292384^r>>>1:r>>>1;i[t]=r>>>0}return i})();function P(i){let t=4294967295;for(let r=0;r<i.length;r++)t=_[(t^i[r])&255]^t>>>8;return(t^4294967295)>>>0}function B(i,t=new Date){const r=new TextEncoder,l=t.getHours()<<11|t.getMinutes()<<5|t.getSeconds()>>1,x=Math.max(1980,t.getFullYear())-1980<<9|t.getMonth()+1<<5|t.getDate(),v=(d,p)=>{const m=new DataView(new ArrayBuffer(d));return p.forEach(([o,e,n])=>n===4?m.setUint32(o,e>>>0,!0):m.setUint16(o,e,!0)),new Uint8Array(m.buffer)},A=[],u=[];let f=0;for(const d of i){const p=r.encode(d.name),m=r.encode(d.text),o=P(m);A.push(v(30,[[0,67324752,4],[4,20,2],[6,2048,2],[8,0,2],[10,l,2],[12,x,2],[14,o,4],[18,m.length,4],[22,m.length,4],[26,p.length,2],[28,0,2]]),p,m),u.push(v(46,[[0,33639248,4],[4,20,2],[6,20,2],[8,2048,2],[10,0,2],[12,l,2],[14,x,2],[16,o,4],[20,m.length,4],[24,m.length,4],[28,p.length,2],[30,0,2],[32,0,2],[34,0,2],[36,0,2],[38,0,4],[42,f,4]]),p),f+=30+p.length+m.length}const k=u.reduce((d,p)=>d+p.length,0),C=v(22,[[0,101010256,4],[4,0,2],[6,0,2],[8,i.length,2],[10,i.length,2],[12,k,4],[16,f,4],[20,0,2]]),E=[...A,...u,C],j=new Uint8Array(E.reduce((d,p)=>d+p.length,0));let T=0;for(const d of E)j.set(d,T),T+=d.length;return j}const N=["shape","structure","generic"];function H(i){const t=z(i.title||""),r=N.includes(i.mode)?i.mode:"generic",l=Number.isFinite(i.seed)?Math.trunc(i.seed):4127,x={};Object.keys(i.maps||{}).forEach(n=>{x[n]=JSON.parse(i.maps[n])});const v=(i.title||"Dashboard").replace(/[\r\n*/`]/g," "),A=N.filter(n=>N.indexOf(n)>=N.indexOf(r)),u=!!i.faker,f=i.realistic!==!1,k=u?`import './vaultsnip-faker.js';
`:"",C=u?` *         realistic  true: made-up names, companies and IDs that fit each column, generated at runtime; false: neutral placeholders (default ${f})
`:"",E=u?`, realistic = ${f}`:"",j=u?"realistic, ":"realistic: false, ",T=u?", realistic":"",d=`'use client';
/*
 * ${v}: a live synthetic replica, generated by VaultSnip (https://vaultsnip.pages.dev).
 * The component runs the VaultSnip replica engine (./vaultsnip-replica.js): every number, chart size, label and tooltip is
 * generated at runtime from ./spec.json and the seed. Cross-filtering and "Download data (CSV)" work as in the app.
 * No source data, screenshot or OCR text is included. Keep the "SYNTHETIC DATA" ribbon and watermark when you reuse it.
 *
 * Props:  seed  any whole number; a new seed generates new values (default ${l})
 *         mode  ${A.map(n=>JSON.stringify(n)).join(" | ")}; exported as ${JSON.stringify(r)}, so it cannot show more than that
${C} */
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
${k}import './vaultsnip-replica.js';
import spec from './spec.json';
import maps from './maps.json';

const LEVELS = ['shape', 'structure', 'generic'];
const EXPORTED = ${JSON.stringify(r)};

let ready = false;
function setup() {
  if (ready) return;
  ready = true;
  if (!window.echarts) window.echarts = echarts;
  Object.keys(maps).forEach((name) => window.DSCReplica.addMap(name, maps[name]));
}

export default function ${t}({ seed = ${l}, mode = EXPORTED${E} }) {
  const ref = useRef(null);
  // a mode less private than the exported one falls back to the exported one
  const level = LEVELS[Math.max(LEVELS.indexOf(mode), LEVELS.indexOf(EXPORTED))];
  useEffect(() => {
    setup();
    const el = ref.current;
    window.DSCReplica.render(el, spec, { mode: level, seed, ${j}resetSelection: true });
    return () => {
      (el._charts || []).forEach((c) => c.dispose());
      if (el._ro) { el._ro.disconnect(); el._ro = null; }
      el._charts = [];
      el.innerHTML = '';
    };
  }, [seed, level${T}]);
  return <div ref={ref} />;
}
`,p="```",m=`# ${t}

A live, synthetic replica of "${v}", exported from [VaultSnip](https://vaultsnip.pages.dev).

## Use it

${p}bash
npm install react echarts
${p}

Copy this folder into your project, then:

${p}jsx
import ${t} from './${t}/${t}';

<${t} />              // the values you saw in VaultSnip
<${t} seed={2024} />  // new generated values
${p}

Works with Vite, Create React App, Next.js (as a client component) and any bundler that imports JSON.

## What is dynamic

Nothing is frozen into the code. The component runs the VaultSnip replica engine (vaultsnip-replica.js), which generates every
value, bubble size, label and tooltip at runtime from spec.json and the seed. Clicking a filter chip, a table row or a chart
segment filters the whole page, and "Download data (CSV)" saves the values on screen.
${u?`
Names, companies, emails and IDs are made up at runtime by vaultsnip-faker.js to fit each column (pass realistic={false} for
neutral placeholders). Emails use only example.com/.net/.org and phone numbers only fictional ranges.
`:""}
To change titles, labels, chart types or the layout, edit spec.json (rows of visuals; "span" is the width out of 12).

## Privacy

Exported at the "${r}" privacy level. spec.json holds only what that level shows, and the component cannot show more.
There is no source data, screenshot or OCR text in this folder, and the component makes no network calls.

## Licence

vaultsnip-replica.js is part of VaultSnip, Apache-2.0 (https://github.com/karthikvalluri85/vaultsnip). The map outlines in
maps.json come from Natural Earth (public domain).${u?" vaultsnip-faker.js bundles Faker (https://github.com/faker-js/faker), MIT License, Copyright (c) 2022-present Faker.":""}
`,o=`/* VaultSnip replica engine. Apache-2.0, https://github.com/karthikvalluri85/vaultsnip
   Exported with ${t}.jsx; defines window.DSCReplica and uses window.echarts. */
${i.replica}`,e=[{name:`${t}/${t}.jsx`,text:d},{name:`${t}/vaultsnip-replica.js`,text:o},...u?[{name:`${t}/vaultsnip-faker.js`,text:`/* VaultSnip realistic-names injector, Apache-2.0, with Faker (MIT, Copyright (c) 2022-present Faker). Defines window.VSFaker. */
`+i.faker+`
if (typeof window !== 'undefined' && typeof VSFaker !== 'undefined') window.VSFaker = VSFaker;
`}]:[],{name:`${t}/spec.json`,text:JSON.stringify(i.spec,null,2)+`
`},{name:`${t}/maps.json`,text:JSON.stringify(x)+`
`},{name:`${t}/README.md`,text:m}];return{name:t,files:e,zip:B(e)}}return $.baselineShift=O,$.componentName=z,$.crc32=P,$.escXml=M,$.layoutText=R,$.paint=F,$.reactPackage=H,$.toSvg=J,$.zip=B,Object.defineProperty($,Symbol.toStringTag,{value:"Module"}),$})({});
