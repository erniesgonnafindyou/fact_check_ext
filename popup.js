import { API_KEY, API_MODEL, API_URL } from "./config.js";
import { searchWeb } from "./search.js";
import { tools } from "./tools.js";

const btn = document.getElementById("checkBtn");
const status = document.getElementById("status");
const tokenInfo = document.getElementById("token-info");
const output = document.getElementById("output");


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

    let messages = [
    {
        role: "system",
        content: `Vandaag is het ${new Date().toLocaleDateString("nl-NL", { year: "numeric", month: "long" })}.
            Je bent een journalistieke factchecker.
            Gebruik de tool search_web om actuele rapporten, claims of cijfers die na je trainingsdatum liggen te verifiëren.
            Start je uiteindelijke antwoord altijd direct met:
             - **Oordeel: BETROUWBAAR**
             - **Oordeel: MET EEN KORREL ZOUT**
             - **Oordeel: MISLEIDEND / ONBETROUWBAAR**
            gevolgd door maximaal 3 korte bullet points.`
    },
    {
        role: "user",
        content: `Hier is de paginatekst:\n\n${pageText}`
    }
    ];

    status.textContent = "Mistral analyseert tekst...";
        let res = await fetch(API_URL, {
         method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
         },
        body: JSON.stringify({
          model: API_MODEL,
          messages: messages,
          tools: tools,
         tool_choice: "auto"
        })
    });

    let data = await res.json();

   // Helper om fouten direct af te vangen
    if (!res.ok || data.error) {
      const errorMsg = data.error?.message || data.message || JSON.stringify(data);
      status.textContent = "Fout";
      output.style.display = "block";
      output.classList.add("error-box");
      output.textContent = `API Fout (${res.status}): ${errorMsg}`;
      return;
    }

    let totalPromptTokens = data.usage?.prompt_tokens || 0;
    let totalCompletionTokens = data.usage?.completion_tokens || 0;

    let responseMessage = data.choices[0].message;

    // Als Mistral besluit een tool aan te roepen
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

      status.textContent = "Oordeel formuleren...";
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: API_MODEL,
          messages: messages,
          max_tokens: 250,
          temperature: 0.2
        })
      });

      data = await res.json();

      // Check ook de 2e call op fouten
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
    }

    // --- JOUW BLOKJE (nu accuraat voor beide situaties) ---
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