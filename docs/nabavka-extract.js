// Скида страницу преко Tauri http плагина (заобилази CORS, ради на native страни)
// и вади аутора, наслов и издавача из schema.org JSON-LD, па генеричким скенирањем
// DOM ознака ("Аутор:"/"Издавач:"), па OG/meta као резерву.
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const AUTHOR_LABEL_RE = /^(autor|aut\.?|аутор|аут\.?)$/i;
const PUBLISHER_LABEL_RE = /^(izdava[cč]|издавач)$/i;

// Сајтови са којих се поручује а нису сами издавач конкретне књиге (нпр. Delfi
// препродаје књиге различитих издавача) — за њих издавач увек постаје сам сајт,
// без обзира шта JSON-LD каже о стварном издавачу те конкретне књиге.
const DOMAIN_IZDAVAC = {
  "delfi.rs": "Delfi",
  "publikpraktikum.rs": "Publik Praktikum - Stela",
  "stelaknjige.rs": "Publik Praktikum - Stela",
  "kreativnicentar.rs": "Kreativni centar",
  "pcelica.rs": "Pčelica Izdavaštvo",
  "vulkani.rs": "Vulkan izdavaštvo",
};

// delfi.rs је React SPA — сирови HTML нема ниједан податак о књизи (све се
// рендерује JS-ом). Њихова страна сама зове овај JSON API; гађамо га директно.
const DELFI_HOST_RE = /(^|\.)delfi\.rs$/i;

export async function extractFromUrl(url){
  let host = "";
  try{ host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase(); }catch{}

  if(DELFI_HOST_RE.test(host)){
    try{
      const viaApi = await extractFromDelfiApi(url);
      if(viaApi) return viaApi;
    }catch{ /* падамо на генеричку HTML логику испод као резерву */ }
  }

  const res = await tauriFetch(url, {
    method: "GET",
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  let autor = "", naslov = "", izdavac = "";

  // 1) JSON-LD (schema.org Book / Product)
  for(const block of doc.querySelectorAll('script[type="application/ld+json"]')){
    let data;
    try { data = JSON.parse(block.textContent); } catch { continue; }
    const nodes = Array.isArray(data) ? data : (data["@graph"] || [data]);
    for(const node of nodes){
      if(!node) continue;
      const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
      if(types.includes("Book") || types.includes("Product")){
        naslov  = naslov  || nameOf(node.name);
        autor   = autor   || nameOf(node.author);
        izdavac = izdavac || nameOf(node.publisher) || nameOf(node.brand);
      }
    }
  }

  // 2) Генеричко скенирање DOM ознака "Аутор:" / "Издавач:" (чест образац на књижарама)
  if(!autor)   autor   = scanLabeledValue(doc, AUTHOR_LABEL_RE);
  if(!izdavac) izdavac = scanLabeledValue(doc, PUBLISHER_LABEL_RE);

  // 2б) Резерва преко CSS класе (нпр. <h3 class="product-authors"><a>...</a></h3>
  // без икаквог "Аутор:" текста у близини — чест образац на неким сајтовима).
  if(!autor)   autor   = scanByClassHint(doc, /autor|author/i);
  if(!izdavac) izdavac = scanByClassHint(doc, /izdava[cč]|publisher/i);

  // 3) OG / meta као резерва
  let ogGuess = null;
  if(!naslov){
    const ogTitle = metaContent(doc, 'meta[property="og:title"]');
    if(ogTitle){
      const parsed = parseOgTitle(ogTitle);
      naslov = parsed.title;
      ogGuess = parsed.authorGuess;
    } else {
      naslov = (doc.querySelector("h1")?.textContent || "").trim();
    }
  }
  if(!autor) autor = metaContent(doc, 'meta[property="book:author"]');

  // 4) meta[name="author"] — последње место, често носи име CMS/платформе, не аутора
  if(!autor) autor = metaContent(doc, 'meta[name="author"]');
  if(!izdavac) izdavac = metaContent(doc, 'meta[property="og:site_name"]');

  // 5) Апсолутно последњи покушај — нагађање из og:title-а
  if(!autor && ogGuess) autor = ogGuess;

  // 6) Деконтаминација наслова преко <h1> — неки сајтови (нпр. Laguna) трпају
  // "Сајт - Наслов - Аутор - Слоган" и у JSON-LD "name" поље, не само у og:title.
  // Ако је чист <h1> садржан у наслову, то је знак да је наслов "h1 + СЕО смеће".
  const h1 = (doc.querySelector("h1")?.textContent || "").trim();
  if(h1 && naslov && naslov.length > h1.length && naslov.toLowerCase().includes(h1.toLowerCase())){
    naslov = h1;
  }

  // 7) Издавач који је голи домен (нпр. "laguna.rs") — скини TLD, остатак
  // постојећи capitalize()+toCyrillic() pipeline у App.jsx претвара исправно.
  izdavac = stripDomainSuffix(izdavac);

  // 8) Познати препродавци (нпр. delfi.rs) — увек преузимају приоритет над
  // JSON-LD издавачем те конкретне књиге, јер се поручује преко њих. Овде је
  // изричито задат тачан облик (вишечлани називи), па се не сме поново
  // "capitalize()"-овати у App.jsx (то би покварило велика слова друге/треће речи).
  let izdavacFixed = false;
  if(DOMAIN_IZDAVAC[host]){ izdavac = DOMAIN_IZDAVAC[host]; izdavacFixed = true; }

  return { autor: clean(autor), naslov: clean(naslov), izdavac: clean(izdavac), izdavacFixed };
}

async function extractFromDelfiApi(url){
  const m = url.match(/\/(\d+)-/);
  const id = m && m[1];
  if(!id) return null;

  const res = await tauriFetch(`https://delfi.rs/api/pc-frontend-api/overview/${id}`, {
    method: "GET",
    headers: { "Accept": "application/json" }
  });
  const json = await res.json();
  const product = json?.data?.product;
  if(!product) return null;

  const autor = (product.authors || []).map(a => a.authorName).filter(Boolean).join(", ");
  return {
    autor: clean(autor),
    naslov: clean(product.title || ""),
    izdavac: "Delfi",
    izdavacFixed: true
  };
}

function stripDomainSuffix(s){
  const m = (s || "").match(/^([a-zA-Z0-9čćžšđČĆŽŠĐ-]+)\.(rs|com|net|org)$/i);
  return m ? m[1] : s;
}

function scanLabeledValue(doc, labelRegex){
  const els = doc.body ? doc.body.querySelectorAll("*") : [];
  for(const el of els){
    // Неки сајтови (нпр. kreativnicentar.rs) трпају више ознака у исти родитељ,
    // одвојене само <br>-овима ("Аутор: ... <br> Илустратор: ... <br>"), па се
    // моraju тестирати по "линији" — спајање целог текста елемента би направило
    // један предуг блок у ком ниједна ознака не одговара регексу.
    for(const line of splitByBr(el.childNodes)){
      const own = line.filter(n=>n.nodeType===3).map(n=>n.textContent).join("");
      if(!own) continue;
      const norm = own.trim().toLowerCase().replace(/:\s*$/, "");
      if(!norm || norm.length > 20 || !labelRegex.test(norm)) continue;

      // (a) текст после ":" у истом тексту линије
      const afterColon = own.split(":").slice(1).join(":").trim();
      if(afterColon) return afterColon;

      // (b) <a> унутар исте линије
      for(const node of line){
        if(node.nodeType !== 1) continue;
        const a = node.tagName === "A" ? node : node.querySelector("a");
        if(a){
          const v = (a.getAttribute("title") || a.textContent || "").trim();
          if(v) return v;
        }
      }

      // (c) nextElementSibling елемента (до 2 корака) — резерва за случај кад
      // је цео елемент само ознака, а вредност је у наредном елементу
      let sib = el.nextElementSibling;
      for(let i=0; i<2 && sib; i++, sib=sib.nextElementSibling){
        const a = sib.tagName === "A" ? sib : sib.querySelector("a");
        if(a){
          const v = (a.getAttribute("title") || a.textContent || "").trim();
          if(v) return v;
        }
        const t = (sib.textContent || "").trim();
        if(t) return t;
      }

      // (d) сусед текст чвор директно на родитељу
      let node = el.nextSibling;
      while(node){
        if(node.nodeType === 3){
          const t = node.textContent.trim();
          if(t) return t;
        }
        node = node.nextSibling;
      }
    }
  }
  return "";
}

// Дели чворове елемента у "линије" на местима где стоји <br>, да би ознаке
// нагomилане у истом родitelju (видети коментар изнад) могле да се тестирају
// засебно уместо као један спojeни текст.
function splitByBr(childNodes){
  const lines = [];
  let cur = [];
  for(const n of childNodes){
    if(n.nodeType === 1 && n.tagName === "BR"){
      lines.push(cur);
      cur = [];
    } else {
      cur.push(n);
    }
  }
  lines.push(cur);
  return lines;
}

function scanByClassHint(doc, hintRegex){
  const els = doc.querySelectorAll("[class]");
  for(const el of els){
    if(!hintRegex.test(el.className)) continue;
    const a = el.querySelector("a");
    if(a){
      const v = (a.getAttribute("title") || a.textContent || "").trim();
      if(v) return v;
    }
    const t = (el.textContent || "").trim();
    if(t && t.length < 80) return t;
  }
  return "";
}

function parseOgTitle(raw){
  let title = raw.split(" | ")[0].trim();
  let authorGuess = null;
  const m = title.match(/^(.+?)\s+-\s+([^-]{2,40})$/);
  if(m){
    const candidateTitle = m[1].trim();
    const candidateAuthor = m[2].trim();
    const wordCount = candidateAuthor.split(/\s+/).length;
    if(wordCount <= 4 && !/[!?:]$/.test(candidateAuthor) && candidateTitle.length >= 3){
      title = candidateTitle;
      authorGuess = candidateAuthor;
    }
  }
  return { title, authorGuess };
}

function nameOf(v){
  if(!v) return "";
  if(typeof v === "string") return v;
  if(Array.isArray(v)) return v.map(nameOf).filter(Boolean).join(", ");
  return v.name || "";
}
function metaContent(doc, sel){
  const el = doc.querySelector(sel);
  return el ? (el.getAttribute("content") || "").trim() : "";
}
function clean(s){ return (s || "").replace(/\s+/g, " ").trim(); }
