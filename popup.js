import { API_KEY, API_MODEL, API_URL } from "./config.js";
import { searchWeb } from "./search.js";
import { tools } from "./tools.js";

const btn = document.getElementById("checkBtn");
const status = document.getElementById("status");
const tokenInfo = document.getElementById("token-info");
const output = document.getElementById("output");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


btn.addEventListener("click", async () => {
  btn.disabled = true;
  status.textContent = "Pagina scannen...";
  tokenInfo.textContent = "";
  output.style.display = "none";
  output.classList.remove("error-box");
  output.textContent = "";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const [{ result: pageText }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText.slice(0, 3000)
    });

    if (!pageText || pageText.trim().length === 0) {
      status.textContent = "";
      output.style.display = "block";
      output.classList.add("error-box");
      output.textContent = "Geen leesbare tekst gevonden op deze pagina.";
      btn.disabled = false;
      return;
    }

    let hostname = "";
    try {
      hostname = new URL(tab.url).hostname;
    } catch {
      hostname = tab.url;
    }

    let messages = [
      {
        role: "system",
        content: `Vandaag is het ${new Date().toLocaleDateString("nl-NL", { year: "numeric", month: "long" })}.
Je bent een meedogenloze factchecker.

Cruciale regels:
1. SANITY CHECK: Controleer absurde, onmogelijke of komische claims (zoals dieren die prijzen winnen, onmogelijke natuurwetten of overduidelijke verzinsels). Neem NIETS voor lief, ook niet als er echte namen (zoals artiesten of politici) omheen staan.
2. VERIFICATIE: Gebruik 'search_web' om verdachte claims, recente feiten of entiteiten te verifiëren. Als een zoekopdracht nog vragen openlaat, mag je een gerichte vervolgzoekopdracht doen. Stop zodra je genoeg bewijs hebt.
3. Als een kernclaim draait om een verzonnen figuur, dier of grap, oordeel dan ALTIJD:
- **Oordeel: MISLEIDEND / ONBETROUWBAAR** (of SATIRE)
4. BRONBEOORDELING: Weeg de reputatie van het domein/platform mee.
Als een beruchte desinformatiesite (zoals Natural News, Infowars) een legitieme studie aanhaalt, benoem dit dan expliciet: de specifieke claim kan kloppen, maar het platform zelf staat bekend om desinformatie en commerciële belangen.
Labels voor regel 1:
- **Oordeel: BETROUWBAAR**
- **Oordeel: MET EEN KORREL ZOUT**
- **Oordeel: MISLEIDEND / ONBETROUWBAAR**

Geef daaronder maximaal 3 korte bullet points waarin je de feiten of nonsens direct blootlegt.`
      },
      {
        role: "user",
        content: `Bron-domein: ${hostname}
Volledige URL: ${tab.url}

Hier is de paginatekst:
${pageText}`
      }
    ];

    // ==========================================
    // VANAF HIER VERVANGT HET DE OUDE FETCH-CODE
    // ==========================================
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let responseMessage = null;

    const MAX_TOOL_ROUNDS = 2; // Veiligheidslimiet: max 3 zoekrondes
    let rounds = 0;

    while (rounds < MAX_TOOL_ROUNDS) {
      status.textContent = rounds === 0 
        ? "Mistral analyseert tekst..." 
        : `Zoekresultaten analyseren (ronde ${rounds + 1})...`;

      if (rounds > 0) {
        await sleep(2100);
      }

      let res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          model: API_MODEL,
          messages: messages,
          tools: tools,
          tool_choice: "auto",
          temperature: 0.2
        })
      });

      let data = await res.json();

      if (!res.ok || data.error) {
        const errorMsg = data.error?.message || data.message || JSON.stringify(data);
        status.textContent = "Fout";
        output.style.display = "block";
        output.classList.add("error-box");
        output.textContent = `API Fout (${res.status}): ${errorMsg}`;
        return;
      }

      if (data.usage) {
        totalPromptTokens += data.usage.prompt_tokens;
        totalCompletionTokens += data.usage.completion_tokens;
      }

      responseMessage = data.choices[0].message;

      // Beslismoment van Mistral: wil hij zoeken?
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        messages.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.function.name === "search_web") {
            const args = JSON.parse(toolCall.function.arguments);
            status.textContent = `Zoeken: "${args.query}"...`;

            const searchResult = await searchWeb(args.query);

            messages.push({
              role: "tool",
              name: "search_web",
              tool_call_id: toolCall.id,
              content: searchResult || "Geen resultaten gevonden."
            });
          }
        }
        rounds++;
      } else {
        // Geen tool calls meer: Mistral heeft zijn definitieve oordeel al geschreven
        break;
      }
    }

    // Noodgreep: als Mistral na 3 rondes nog steeds tools wilde aanroepen,
    // dwingen we 1 laatste call af zonder tools zodat we altijd tekst tonen
    if (!responseMessage.content || responseMessage.tool_calls) {
      status.textContent = "Definitief oordeel formuleren...";
      let res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: API_MODEL,
          messages: messages,
          max_tokens: 1000,
          temperature: 0.2
        })
      });

      let data = await res.json();
      if (data.usage) {
        totalPromptTokens += data.usage.prompt_tokens;
        totalCompletionTokens += data.usage.completion_tokens;
      }
      responseMessage = data.choices[0].message;
    }
    // ==========================================
    // TOT HIER
    // ==========================================

    status.textContent = "Klaar";
    if (totalPromptTokens || totalCompletionTokens) {
      tokenInfo.textContent = `${totalPromptTokens} in / ${totalCompletionTokens} uit`;
    }

    output.style.display = "block";
    output.innerHTML = renderMarkdown(responseMessage.content);

  } catch (err) {
    status.textContent = "Fout";
    output.style.display = "block";
    output.classList.add("error-box");
    output.textContent = `Fout: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

function renderMarkdown(md) {
  return md
    // Escape HTML tekens tegen injecties
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Headers
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    // Bold & Cursief
    .replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gim, "<em>$1</em>")
    // Horizontale lijnen
    .replace(/^---$/gim, "<hr>")
    // Bullet points (- of *)
    .replace(/^\s*[-*]\s+(.*$)/gim, "<li>$1</li>")
    // Paragrafen en enters (dubbele enter = witruimte)
    .replace(/\n\n+/g, "<br><br>")
    .replace(/\n/g, "<br>");
}