var VSDesign=(function(y){"use strict";function V(i){const e=String(i||"").trim();if(!e||e==="transparent"||e==="none")return null;const s=/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(e);if(s){const l=s[4]==null?1:s[4].endsWith("%")?parseFloat(s[4])/100:parseFloat(s[4]);return l>0?{color:"#"+[s[1],s[2],s[3]].map(v=>Math.max(0,Math.min(255,Math.round(+v))).toString(16).padStart(2,"0")).join(""),opacity:Math.min(1,l)}:null}return/^#[0-9a-f]{3,8}$/i.test(e)?{color:e.toLowerCase(),opacity:1}:null}const X=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\ufffe\uffff]/g,N=i=>String(i??"").replace(X,"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[e]),c=i=>Math.round(i*100)/100;function O(i,e="normal",s="none"){let l=/^pre/.test(e)?i:i.replace(/\s+/g," ");return s==="uppercase"?l=l.toUpperCase():s==="lowercase"&&(l=l.toLowerCase()),l}function z(i){const e=i.toLowerCase();return e==="central"||e==="middle"?.35:e==="hanging"||e==="text-before-edge"?.8:e==="text-after-edge"||e==="ideographic"?-.2:0}function F(i){return(String(i||"").normalize("NFKD").replace(/[^\w\s]/g," ").trim().split(/\s+/).filter(Boolean).slice(0,5).map(l=>l[0].toUpperCase()+l.slice(1).toLowerCase()).join("").replace(/^[^A-Za-z]+/,"")||"Dashboard")+"Replica"}const J=i=>!!i.classList&&i.classList.contains("rp-csv");function _(i,e={}){const s=i.getBoundingClientRect(),l=Math.ceil(s.width),$=Math.ceil(i.scrollHeight||s.height),v=o=>({x:c(o.left-s.left),y:c(o.top-s.top),w:c(o.width),h:c(o.height)}),C=[];let A=0;const p=[],E=o=>o?`fill="${o.color}"${o.opacity<1?` fill-opacity="${c(o.opacity)}"`:""}`:'fill="none"';function T(o){const t=getComputedStyle(o);if(t.display==="none"||t.visibility==="hidden"||J(o))return;const r=v(o.getBoundingClientRect()),u=parseFloat(t.opacity),h=[];if(u<1&&(p.push(`<g opacity="${c(u)}">`),h.push("</g>")),o instanceof SVGSVGElement||o.localName==="svg"){r.w>0&&r.h>0&&p.push(D(o,r)),p.push(...h.reverse());return}if(r.w>0&&r.h>0&&p.push(...j(t,r)),(t.overflow!=="visible"||t.overflowX!=="visible"||t.overflowY!=="visible")&&r.w>0&&r.h>0){const n="vs-clip-"+ ++A,b=Math.min(parseFloat(t.borderTopLeftRadius)||0,r.w/2,r.h/2);C.push(`<clipPath id="${n}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"${b?` rx="${c(b)}"`:""}/></clipPath>`),p.push(`<g clip-path="url(#${n})">`),h.push("</g>")}for(const n of Array.from(o.childNodes))n.nodeType===1?T(n):n.nodeType===3&&x(n,t);p.push(...h.reverse())}function j(o,t){const r=[],u=V(o.backgroundColor),h=Math.min(parseFloat(o.borderTopLeftRadius)||0,t.w/2,t.h/2),S=a=>({w:parseFloat(o.getPropertyValue(`border-${a.toLowerCase()}-width`))||0,p:o.getPropertyValue(`border-${a.toLowerCase()}-style`)==="none"?null:V(o.getPropertyValue(`border-${a.toLowerCase()}-color`))}),n={t:S("Top"),r:S("Right"),b:S("Bottom"),l:S("Left")},L=[n.t,n.r,n.b,n.l].every(a=>a.w===n.t.w&&a.p&&n.t.p&&a.p.color===n.t.p.color),k=h?` rx="${c(h)}"`:"";if(L&&n.t.w>0&&n.t.p){const a=n.t.w;return r.push(`<rect x="${c(t.x+a/2)}" y="${c(t.y+a/2)}" width="${c(Math.max(0,t.w-a))}" height="${c(Math.max(0,t.h-a))}"${k} ${E(u)} stroke="${n.t.p.color}"${n.t.p.opacity<1?` stroke-opacity="${c(n.t.p.opacity)}"`:""} stroke-width="${c(a)}"/>`),r}u&&r.push(`<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}"${k} ${E(u)}/>`);const M=(a,m,w,U,W)=>{W&&w>0&&U>0&&r.push(`<rect x="${c(a)}" y="${c(m)}" width="${c(w)}" height="${c(U)}" ${E(W)}/>`)};return M(t.x,t.y,t.w,n.t.w,n.t.p),M(t.x,t.y+t.h-n.b.w,t.w,n.b.w,n.b.p),M(t.x,t.y,n.l.w,t.h,n.l.p),M(t.x+t.w-n.r.w,t.y,n.r.w,t.h,n.r.p),r}function x(o,t){const r=o.textContent||"";if(!r.trim())return;const u=document.createRange();u.selectNodeContents(o);const h=Array.from(u.getClientRects()).filter(a=>a.width>0&&a.height>0);if(!h.length)return;const S=[];if(h.length===1)S.push({x:h[0].left,top:h[0].top,h:h[0].height,s:r});else{let a=null;for(let m=0;m<r.length;m++){u.setStart(o,m),u.setEnd(o,m+1);const w=u.getClientRects()[0];if(!w||!w.width&&/\s/.test(r[m])){a&&(a.s+=r[m]);continue}(!a||Math.abs(w.top-a.top)>w.height/2)&&(a={x:w.left,top:w.top,h:w.height,s:""},S.push(a)),a.s+=r[m]}}const n=parseFloat(t.fontSize)||14,b=V(t.color)||{color:"#000000",opacity:1},L=N(t.fontFamily.replace(/"/g,"'")),k=t.fontWeight&&t.fontWeight!=="400"&&t.fontWeight!=="normal"?` font-weight="${N(t.fontWeight)}"`:"",M=t.fontStyle==="italic"?' font-style="italic"':"";for(const a of S){const m=O(a.s,t.whiteSpace,t.textTransform).trim();if(!m)continue;const w=a.top-s.top+a.h/2+n*.35;p.push(`<text x="${c(a.x-s.left)}" y="${c(w)}" font-family="${L}" font-size="${c(n)}"${k}${M} ${E(b)} xml:space="preserve">${N(m)}</text>`)}}function D(o,t){const r=o.cloneNode(!0);r.getAttribute("viewBox")||r.setAttribute("viewBox",`0 0 ${t.w} ${t.h}`),r.setAttribute("x",String(t.x)),r.setAttribute("y",String(t.y)),r.setAttribute("width",String(t.w)),r.setAttribute("height",String(t.h)),r.removeAttribute("style"),r.removeAttribute("class");const u=getComputedStyle(o).fontFamily.replace(/"/g,"'");r.querySelectorAll("text").forEach(n=>{const b=n.getAttribute("style")||"";/font-family:\s*inherit/.test(b)?n.setAttribute("style",b.replace(/font-family:\s*inherit/,"font-family: "+u)):!/font-family/.test(b)&&!n.getAttribute("font-family")&&n.setAttribute("font-family",u);const L=n.getAttribute("dominant-baseline");if(!L)return;const k=parseFloat((/font-size:\s*([\d.]+)px/.exec(b)||[])[1]||n.getAttribute("font-size")||"12");n.removeAttribute("dominant-baseline"),n.setAttribute("y",String(c((parseFloat(n.getAttribute("y")||"0")||0)+z(L)*k)))});const h=++A;return new XMLSerializer().serializeToString(r).replace(/\bid="([^"]+)"/g,`id="$1-v${h}"`).replace(/url\(#([^)]+)\)/g,`url(#$1-v${h})`).replace(/href="#([^"]+)"/g,`href="#$1-v${h}"`)}T(i);const d=V(getComputedStyle(i).color)||{color:"#14181e"},f=[];for(let o=0;o<$;o+=200)for(let t=0;t<l;t+=340)f.push(`<text x="${t+170}" y="${o+108}" transform="rotate(-22 ${t+170} ${o+100})" text-anchor="middle">SYNTHETIC DATA</text>`);const g=N((e.title||"Dashboard replica")+" (synthetic data)");return`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${l}" height="${$}" viewBox="0 0 ${l} ${$}" data-synthetic="true">
<title>${g}</title>
<desc>Generated with VaultSnip. Every value is synthetic; this file contains no source data.</desc>
<defs><clipPath id="vs-page"><rect width="${l}" height="${$}" rx="10"/></clipPath>${C.join("")}</defs>
<g id="replica" clip-path="url(#vs-page)">
${p.join(`
`)}
</g>
<g id="watermark" fill="${d.color}" fill-opacity="0.07" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="3" clip-path="url(#vs-page)">${f.join("")}</g>
</svg>
`}const H=(()=>{const i=new Uint32Array(256);for(let e=0;e<256;e++){let s=e;for(let l=0;l<8;l++)s=s&1?3988292384^s>>>1:s>>>1;i[e]=s>>>0}return i})();function P(i){let e=4294967295;for(let s=0;s<i.length;s++)e=H[(e^i[s])&255]^e>>>8;return(e^4294967295)>>>0}function B(i,e=new Date){const s=new TextEncoder,l=e.getHours()<<11|e.getMinutes()<<5|e.getSeconds()>>1,$=Math.max(1980,e.getFullYear())-1980<<9|e.getMonth()+1<<5|e.getDate(),v=(d,f)=>{const g=new DataView(new ArrayBuffer(d));return f.forEach(([o,t,r])=>r===4?g.setUint32(o,t>>>0,!0):g.setUint16(o,t,!0)),new Uint8Array(g.buffer)},C=[],A=[];let p=0;for(const d of i){const f=s.encode(d.name),g=s.encode(d.text),o=P(g);C.push(v(30,[[0,67324752,4],[4,20,2],[6,2048,2],[8,0,2],[10,l,2],[12,$,2],[14,o,4],[18,g.length,4],[22,g.length,4],[26,f.length,2],[28,0,2]]),f,g),A.push(v(46,[[0,33639248,4],[4,20,2],[6,20,2],[8,2048,2],[10,0,2],[12,l,2],[14,$,2],[16,o,4],[20,g.length,4],[24,g.length,4],[28,f.length,2],[30,0,2],[32,0,2],[34,0,2],[36,0,2],[38,0,4],[42,p,4]]),f),p+=30+f.length+g.length}const E=A.reduce((d,f)=>d+f.length,0),T=v(22,[[0,101010256,4],[4,0,2],[6,0,2],[8,i.length,2],[10,i.length,2],[12,E,4],[16,p,4],[20,0,2]]),j=[...C,...A,T],x=new Uint8Array(j.reduce((d,f)=>d+f.length,0));let D=0;for(const d of j)x.set(d,D),D+=d.length;return x}const R=["shape","structure","generic"];function Y(i){const e=F(i.title||""),s=R.includes(i.mode)?i.mode:"generic",l=Number.isFinite(i.seed)?Math.trunc(i.seed):4127,$={};Object.keys(i.maps||{}).forEach(x=>{$[x]=JSON.parse(i.maps[x])});const v=(i.title||"Dashboard").replace(/[\r\n*/`]/g," "),C=R.filter(x=>R.indexOf(x)>=R.indexOf(s)),A=`'use client';
/*
 * ${v}: a live synthetic replica, generated by VaultSnip (https://vaultsnip.pages.dev).
 * The component runs the VaultSnip replica engine (./vaultsnip-replica.js): every number, chart size, label and tooltip is
 * generated at runtime from ./spec.json and the seed. Cross-filtering and "Download data (CSV)" work as in the app.
 * No source data, screenshot or OCR text is included. Keep the "SYNTHETIC DATA" ribbon and watermark when you reuse it.
 *
 * Props:  seed  any whole number; a new seed generates new values (default ${l})
 *         mode  ${C.map(x=>JSON.stringify(x)).join(" | ")}; exported as ${JSON.stringify(s)}, so it cannot show more than that
 */
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import './vaultsnip-replica.js';
import spec from './spec.json';
import maps from './maps.json';

const LEVELS = ['shape', 'structure', 'generic'];
const EXPORTED = ${JSON.stringify(s)};

let ready = false;
function setup() {
  if (ready) return;
  ready = true;
  if (!window.echarts) window.echarts = echarts;
  Object.keys(maps).forEach((name) => window.DSCReplica.addMap(name, maps[name]));
}

export default function ${e}({ seed = ${l}, mode = EXPORTED }) {
  const ref = useRef(null);
  // a mode less private than the exported one falls back to the exported one
  const level = LEVELS[Math.max(LEVELS.indexOf(mode), LEVELS.indexOf(EXPORTED))];
  useEffect(() => {
    setup();
    const el = ref.current;
    window.DSCReplica.render(el, spec, { mode: level, seed, resetSelection: true });
    return () => {
      (el._charts || []).forEach((c) => c.dispose());
      if (el._ro) { el._ro.disconnect(); el._ro = null; }
      el._charts = [];
      el.innerHTML = '';
    };
  }, [seed, level]);
  return <div ref={ref} />;
}
`,p="```",E=`# ${e}

A live, synthetic replica of "${v}", exported from [VaultSnip](https://vaultsnip.pages.dev).

## Use it

${p}bash
npm install react echarts
${p}

Copy this folder into your project, then:

${p}jsx
import ${e} from './${e}/${e}';

<${e} />              // the values you saw in VaultSnip
<${e} seed={2024} />  // new generated values
${p}

Works with Vite, Create React App, Next.js (as a client component) and any bundler that imports JSON.

## What is dynamic

Nothing is frozen into the code. The component runs the VaultSnip replica engine (vaultsnip-replica.js), which generates every
value, bubble size, label and tooltip at runtime from spec.json and the seed. Clicking a filter chip, a table row or a chart
segment filters the whole page, and "Download data (CSV)" saves the values on screen.

To change titles, labels, chart types or the layout, edit spec.json (rows of visuals; "span" is the width out of 12).

## Privacy

Exported at the "${s}" privacy level. spec.json holds only what that level shows, and the component cannot show more.
There is no source data, screenshot or OCR text in this folder, and the component makes no network calls.

## Licence

vaultsnip-replica.js is part of VaultSnip, Apache-2.0 (https://github.com/karthikvalluri85/vaultsnip). The map outlines in
maps.json come from Natural Earth (public domain).
`,T=`/* VaultSnip replica engine. Apache-2.0, https://github.com/karthikvalluri85/vaultsnip
   Exported with ${e}.jsx; defines window.DSCReplica and uses window.echarts. */
${i.replica}`,j=[{name:`${e}/${e}.jsx`,text:A},{name:`${e}/vaultsnip-replica.js`,text:T},{name:`${e}/spec.json`,text:JSON.stringify(i.spec,null,2)+`
`},{name:`${e}/maps.json`,text:JSON.stringify($)+`
`},{name:`${e}/README.md`,text:E}];return{name:e,files:j,zip:B(j)}}return y.baselineShift=z,y.componentName=F,y.crc32=P,y.escXml=N,y.layoutText=O,y.paint=V,y.reactPackage=Y,y.toSvg=_,y.zip=B,Object.defineProperty(y,Symbol.toStringTag,{value:"Module"}),y})({});
