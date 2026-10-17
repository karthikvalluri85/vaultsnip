var VSDesign=(function($){"use strict";function D(n){const t=String(n||"").trim();if(!t||t==="transparent"||t==="none")return null;const a=/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(t);if(a){const l=a[4]==null?1:a[4].endsWith("%")?parseFloat(a[4])/100:parseFloat(a[4]);return l>0?{color:"#"+[a[1],a[2],a[3]].map(x=>Math.max(0,Math.min(255,Math.round(+x))).toString(16).padStart(2,"0")).join(""),opacity:Math.min(1,l)}:null}return/^#[0-9a-f]{3,8}$/i.test(t)?{color:t.toLowerCase(),opacity:1}:null}const W=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\ufffe\uffff]/g,F=n=>String(n??"").replace(W,"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[t]),c=n=>Math.round(n*100)/100;function O(n,t="normal",a="none"){let l=/^pre/.test(t)?n:n.replace(/\s+/g," ");return a==="uppercase"?l=l.toUpperCase():a==="lowercase"&&(l=l.toLowerCase()),l}function R(n){const t=n.toLowerCase();return t==="central"||t==="middle"?.35:t==="hanging"||t==="text-before-edge"?.8:t==="text-after-edge"||t==="ideographic"?-.2:0}function z(n){return(String(n||"").normalize("NFKD").replace(/[^\w\s]/g," ").trim().split(/\s+/).filter(Boolean).slice(0,5).map(l=>l[0].toUpperCase()+l.slice(1).toLowerCase()).join("").replace(/^[^A-Za-z]+/,"")||"Dashboard")+"Replica"}const X=n=>!!n.classList&&(n.classList.contains("rp-csv")||n.classList.contains("rp-search"));function J(n,t={}){const a=n.getBoundingClientRect(),l=Math.ceil(a.width),v=Math.ceil(n.scrollHeight||a.height),x=i=>({x:c(i.left-a.left),y:c(i.top-a.top),w:c(i.width),h:c(i.height)}),A=[];let d=0;const m=[],k=i=>i?`fill="${i.color}"${i.opacity<1?` fill-opacity="${c(i.opacity)}"`:""}`:'fill="none"';function C(i){const e=getComputedStyle(i);if(e.display==="none"||e.visibility==="hidden"||X(i))return;const s=x(i.getBoundingClientRect()),p=parseFloat(e.opacity),u=[];if(p<1&&(m.push(`<g opacity="${c(p)}">`),u.push("</g>")),i instanceof SVGSVGElement||i.localName==="svg"){s.w>0&&s.h>0&&m.push(V(i,s)),m.push(...u.reverse());return}if(s.w>0&&s.h>0&&m.push(...j(e,s)),(e.overflow!=="visible"||e.overflowX!=="visible"||e.overflowY!=="visible")&&s.w>0&&s.h>0){const r="vs-clip-"+ ++d,b=Math.min(parseFloat(e.borderTopLeftRadius)||0,s.w/2,s.h/2);A.push(`<clipPath id="${r}"><rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"${b?` rx="${c(b)}"`:""}/></clipPath>`),m.push(`<g clip-path="url(#${r})">`),u.push("</g>")}for(const r of Array.from(i.childNodes))r.nodeType===1?C(r):r.nodeType===3&&E(r,e);m.push(...u.reverse())}function j(i,e){const s=[],p=D(i.backgroundColor),u=Math.min(parseFloat(i.borderTopLeftRadius)||0,e.w/2,e.h/2),S=o=>({w:parseFloat(i.getPropertyValue(`border-${o.toLowerCase()}-width`))||0,p:i.getPropertyValue(`border-${o.toLowerCase()}-style`)==="none"?null:D(i.getPropertyValue(`border-${o.toLowerCase()}-color`))}),r={t:S("Top"),r:S("Right"),b:S("Bottom"),l:S("Left")},L=[r.t,r.r,r.b,r.l].every(o=>o.w===r.t.w&&o.p&&r.t.p&&o.p.color===r.t.p.color),T=u?` rx="${c(u)}"`:"";if(L&&r.t.w>0&&r.t.p){const o=r.t.w;return s.push(`<rect x="${c(e.x+o/2)}" y="${c(e.y+o/2)}" width="${c(Math.max(0,e.w-o))}" height="${c(Math.max(0,e.h-o))}"${T} ${k(p)} stroke="${r.t.p.color}"${r.t.p.opacity<1?` stroke-opacity="${c(r.t.p.opacity)}"`:""} stroke-width="${c(o)}"/>`),s}p&&s.push(`<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}"${T} ${k(p)}/>`);const M=(o,w,y,I,U)=>{U&&y>0&&I>0&&s.push(`<rect x="${c(o)}" y="${c(w)}" width="${c(y)}" height="${c(I)}" ${k(U)}/>`)};return M(e.x,e.y,e.w,r.t.w,r.t.p),M(e.x,e.y+e.h-r.b.w,e.w,r.b.w,r.b.p),M(e.x,e.y,r.l.w,e.h,r.l.p),M(e.x+e.w-r.r.w,e.y,r.r.w,e.h,r.r.p),s}function E(i,e){const s=i.textContent||"";if(!s.trim())return;const p=document.createRange();p.selectNodeContents(i);const u=Array.from(p.getClientRects()).filter(o=>o.width>0&&o.height>0);if(!u.length)return;const S=[];if(u.length===1)S.push({x:u[0].left,top:u[0].top,h:u[0].height,s});else{let o=null;for(let w=0;w<s.length;w++){p.setStart(i,w),p.setEnd(i,w+1);const y=p.getClientRects()[0];if(!y||!y.width&&/\s/.test(s[w])){o&&(o.s+=s[w]);continue}(!o||Math.abs(y.top-o.top)>y.height/2)&&(o={x:y.left,top:y.top,h:y.height,s:""},S.push(o)),o.s+=s[w]}}const r=parseFloat(e.fontSize)||14,b=D(e.color)||{color:"#000000",opacity:1},L=F(e.fontFamily.replace(/"/g,"'")),T=e.fontWeight&&e.fontWeight!=="400"&&e.fontWeight!=="normal"?` font-weight="${F(e.fontWeight)}"`:"",M=e.fontStyle==="italic"?' font-style="italic"':"";for(const o of S){const w=O(o.s,e.whiteSpace,e.textTransform).trim();if(!w)continue;const y=o.top-a.top+o.h/2+r*.35;m.push(`<text x="${c(o.x-a.left)}" y="${c(y)}" font-family="${L}" font-size="${c(r)}"${T}${M} ${k(b)} xml:space="preserve">${F(w)}</text>`)}}function V(i,e){const s=i.cloneNode(!0);s.getAttribute("viewBox")||s.setAttribute("viewBox",`0 0 ${e.w} ${e.h}`),s.setAttribute("x",String(e.x)),s.setAttribute("y",String(e.y)),s.setAttribute("width",String(e.w)),s.setAttribute("height",String(e.h)),s.removeAttribute("style"),s.removeAttribute("class");const p=getComputedStyle(i).fontFamily.replace(/"/g,"'");s.querySelectorAll("text").forEach(r=>{const b=r.getAttribute("style")||"";/font-family:\s*inherit/.test(b)?r.setAttribute("style",b.replace(/font-family:\s*inherit/,"font-family: "+p)):!/font-family/.test(b)&&!r.getAttribute("font-family")&&r.setAttribute("font-family",p);const L=r.getAttribute("dominant-baseline");if(!L)return;const T=parseFloat((/font-size:\s*([\d.]+)px/.exec(b)||[])[1]||r.getAttribute("font-size")||"12");r.removeAttribute("dominant-baseline"),r.setAttribute("y",String(c((parseFloat(r.getAttribute("y")||"0")||0)+R(L)*T)))});const u=++d;return new XMLSerializer().serializeToString(s).replace(/\bid="([^"]+)"/g,`id="$1-v${u}"`).replace(/url\(#([^)]+)\)/g,`url(#$1-v${u})`).replace(/href="#([^"]+)"/g,`href="#$1-v${u}"`)}C(n);const g=D(getComputedStyle(n).color)||{color:"#14181e"},f=[];for(let i=0;i<v;i+=200)for(let e=0;e<l;e+=340)f.push(`<text x="${e+170}" y="${i+108}" transform="rotate(-22 ${e+170} ${i+100})" text-anchor="middle">SYNTHETIC DATA</text>`);const h=F((t.title||"Dashboard replica")+" (synthetic data)");return`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${l}" height="${v}" viewBox="0 0 ${l} ${v}" data-synthetic="true">
<title>${h}</title>
<desc>Generated with VaultSnip. Every value is synthetic; this file contains no source data.</desc>
<defs><clipPath id="vs-page"><rect width="${l}" height="${v}" rx="10"/></clipPath>${A.join("")}</defs>
<g id="replica" clip-path="url(#vs-page)">
${m.join(`
`)}
</g>
<g id="watermark" fill="${g.color}" fill-opacity="0.07" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="3" clip-path="url(#vs-page)">${f.join("")}</g>
</svg>
`}const _=(()=>{const n=new Uint32Array(256);for(let t=0;t<256;t++){let a=t;for(let l=0;l<8;l++)a=a&1?3988292384^a>>>1:a>>>1;n[t]=a>>>0}return n})();function P(n){let t=4294967295;for(let a=0;a<n.length;a++)t=_[(t^n[a])&255]^t>>>8;return(t^4294967295)>>>0}function B(n,t=new Date){const a=new TextEncoder,l=t.getHours()<<11|t.getMinutes()<<5|t.getSeconds()>>1,v=Math.max(1980,t.getFullYear())-1980<<9|t.getMonth()+1<<5|t.getDate(),x=(g,f)=>{const h=new DataView(new ArrayBuffer(g));return f.forEach(([i,e,s])=>s===4?h.setUint32(i,e>>>0,!0):h.setUint16(i,e,!0)),new Uint8Array(h.buffer)},A=[],d=[];let m=0;for(const g of n){const f=a.encode(g.name),h=a.encode(g.text),i=P(h);A.push(x(30,[[0,67324752,4],[4,20,2],[6,2048,2],[8,0,2],[10,l,2],[12,v,2],[14,i,4],[18,h.length,4],[22,h.length,4],[26,f.length,2],[28,0,2]]),f,h),d.push(x(46,[[0,33639248,4],[4,20,2],[6,20,2],[8,2048,2],[10,0,2],[12,l,2],[14,v,2],[16,i,4],[20,h.length,4],[24,h.length,4],[28,f.length,2],[30,0,2],[32,0,2],[34,0,2],[36,0,2],[38,0,4],[42,m,4]]),f),m+=30+f.length+h.length}const k=d.reduce((g,f)=>g+f.length,0),C=x(22,[[0,101010256,4],[4,0,2],[6,0,2],[8,n.length,2],[10,n.length,2],[12,k,4],[16,m,4],[20,0,2]]),j=[...A,...d,C],E=new Uint8Array(j.reduce((g,f)=>g+f.length,0));let V=0;for(const g of j)E.set(g,V),V+=g.length;return E}const N=["shape","structure","generic"];function H(n){const t=z(n.title||""),a=N.includes(n.mode)?n.mode:"generic",l=Number.isFinite(n.seed)?Math.trunc(n.seed):4127,v={};Object.keys(n.maps||{}).forEach(p=>{v[p]=JSON.parse(n.maps[p])});const x=(n.title||"Dashboard").replace(/[\r\n*/`]/g," "),A=N.filter(p=>N.indexOf(p)>=N.indexOf(a)),d=!!n.faker,m=n.realistic!==!1,k=d?`import './vaultsnip-faker.js';
`:"",C=d?` *         realistic  true: made-up names, companies and IDs that fit each column, generated at runtime; false: neutral placeholders (default ${m})
`:"",j=d?`, realistic = ${m}`:"",E=d?"realistic, ":"realistic: false, ",V=d?", realistic":"",g=n.search?`import './vaultsnip-search.js';
`:"",f=`'use client';
/*
 * ${x}: a live synthetic replica, generated by VaultSnip (https://vaultsnip.pages.dev).
 * The component runs the VaultSnip replica engine (./vaultsnip-replica.js): every number, chart size, label and tooltip is
 * generated at runtime from ./spec.json and the seed. Cross-filtering, "Download data (CSV)"
 * and "Search this dashboard" work as in the app.
 * No source data, screenshot or OCR text is included. Keep the "SYNTHETIC DATA" ribbon and watermark when you reuse it.
 *
 * Props:  seed  any whole number; a new seed generates new values (default ${l})
 *         mode  ${A.map(p=>JSON.stringify(p)).join(" | ")}; exported as ${JSON.stringify(a)}, so it cannot show more than that
${C} */
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
${k}${g}import './vaultsnip-replica.js';
import spec from './spec.json';
import maps from './maps.json';

const LEVELS = ['shape', 'structure', 'generic'];
const EXPORTED = ${JSON.stringify(a)};

let ready = false;
function setup() {
  if (ready) return;
  ready = true;
  if (!window.echarts) window.echarts = echarts;
  Object.keys(maps).forEach((name) => window.DSCReplica.addMap(name, maps[name]));
}

export default function ${t}({ seed = ${l}, mode = EXPORTED${j} }) {
  const ref = useRef(null);
  // a mode less private than the exported one falls back to the exported one
  const level = LEVELS[Math.max(LEVELS.indexOf(mode), LEVELS.indexOf(EXPORTED))];
  useEffect(() => {
    setup();
    const el = ref.current;
    window.DSCReplica.render(el, spec, { mode: level, seed, ${E}resetSelection: true });
    return () => {
      (el._charts || []).forEach((c) => c.dispose());
      if (el._ro) { el._ro.disconnect(); el._ro = null; }
      el._charts = [];
      el.innerHTML = '';
    };
  }, [seed, level${V}]);
  return <div ref={ref} />;
}
`,h="```",i=`# ${t}

A live, synthetic replica of "${x}", exported from [VaultSnip](https://vaultsnip.pages.dev).

## Use it

${h}bash
npm install react echarts
${h}

Copy this folder into your project, then:

${h}jsx
import ${t} from './${t}/${t}';

<${t} />              // the values you saw in VaultSnip
<${t} seed={2024} />  // new generated values
${h}

Works with Vite, Create React App, Next.js (as a client component) and any bundler that imports JSON.

## What is dynamic

Nothing is frozen into the code. The component runs the VaultSnip replica engine (vaultsnip-replica.js), which generates every
value, bubble size, label and tooltip at runtime from spec.json and the seed. Clicking a filter chip, a table row or a chart
segment filters the whole page, "Download data (CSV)" saves the values on screen, and "Search this dashboard" finds any
title, label or value shown (its index is rebuilt from the page on every render).
${d?`
Names, companies, emails and IDs are made up at runtime by vaultsnip-faker.js to fit each column (pass realistic={false} for
neutral placeholders). Emails use only example.com/.net/.org and phone numbers only fictional ranges.
`:""}
To change titles, labels, chart types or the layout, edit spec.json (rows of visuals; "span" is the width out of 12).

## Privacy

Exported at the "${a}" privacy level. spec.json holds only what that level shows, and the component cannot show more.
There is no source data, screenshot or OCR text in this folder, and the component makes no network calls.

## Licence

vaultsnip-replica.js is part of VaultSnip, Apache-2.0 (https://github.com/karthikvalluri85/vaultsnip). The map outlines in
maps.json come from Natural Earth (public domain).${d?" vaultsnip-faker.js bundles Faker (https://github.com/faker-js/faker), MIT License, Copyright (c) 2022-present Faker.":""}${n.search?" vaultsnip-search.js bundles MiniSearch (https://github.com/lucaong/minisearch), MIT License, Copyright (c) 2022 Luca Ongaro.":""}
`,e=`/* VaultSnip replica engine. Apache-2.0, https://github.com/karthikvalluri85/vaultsnip
   Exported with ${t}.jsx; defines window.DSCReplica and uses window.echarts. */
${n.replica}`,s=[{name:`${t}/${t}.jsx`,text:f},{name:`${t}/vaultsnip-replica.js`,text:e},...d?[{name:`${t}/vaultsnip-faker.js`,text:`/* VaultSnip realistic-names injector, Apache-2.0, with Faker (MIT, Copyright (c) 2022-present Faker). Defines window.VSFaker. */
`+n.faker+`
if (typeof window !== 'undefined' && typeof VSFaker !== 'undefined') window.VSFaker = VSFaker;
`}]:[],...n.search?[{name:`${t}/vaultsnip-search.js`,text:`/* VaultSnip replica search, Apache-2.0, with MiniSearch (MIT, Copyright (c) 2022 Luca Ongaro). Defines window.VSSearch. */
`+n.search+`
if (typeof window !== 'undefined' && typeof VSSearch !== 'undefined') window.VSSearch = VSSearch;
`}]:[],{name:`${t}/spec.json`,text:JSON.stringify(n.spec,null,2)+`
`},{name:`${t}/maps.json`,text:JSON.stringify(v)+`
`},{name:`${t}/README.md`,text:i}];return{name:t,files:s,zip:B(s)}}return $.baselineShift=R,$.componentName=z,$.crc32=P,$.escXml=F,$.layoutText=O,$.paint=D,$.reactPackage=H,$.toSvg=J,$.zip=B,Object.defineProperty($,Symbol.toStringTag,{value:"Module"}),$})({});
