// Stand-in for the Gemini REST API during integration tests (no real key, no
// network). Answers generateContent / streamGenerateContent (SSE) and keeps
// the last request so tests can inspect what the app sent to the model.
import http from "node:http";

const port = Number(process.env.GEMINI_STUB_PORT || 3999);
let last = null;
// Overload simulation: "#overload-once" is refused once per text, "#overload-always" every time.
const seen = new Map();

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/v1beta/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: [
        { name: "models/gemini-9.9-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
        { name: "models/gemini-9.9-flash-image", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-9", supportedGenerationMethods: ["embedContent"] },
      ] }));
    }
    // Retired ids answer like Google does: 404 naming the replacement.
    if (req.method === "POST" && /\/models\/retired-/.test(req.url)) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { code: 404, status: "NOT_FOUND", message: "This model is no longer available." } }));
    }
    if (req.method === "GET" && req.url.startsWith("/count")) {
      const text = decodeURIComponent(req.url.split("?q=")[1] ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ count: seen.get(text) ?? 0 }));
    }
    if (req.method === "GET" && req.url === "/last") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(last));
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      last = { url: req.url, apiKey: req.headers["x-goog-api-key"], body };
      const userText = body.contents?.at(-1)?.parts?.map((p) => p.text ?? "[file]").join(" ") ?? "";
      const hasFile = body.contents?.some((c) => c.parts?.some((p) => p.inlineData));
      const overload = userText.includes("#overload-always") || (userText.includes("#overload-once") && !seen.has(userText));
      if (userText.includes("#overload")) seen.set(userText, (seen.get(userText) ?? 0) + 1);
      if (overload) {
        res.writeHead(503, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "This model is currently experiencing high demand." } }));
      }
      // JSON mode (structured AI actions and the AI dashboard builder).
      if (body.generationConfig?.responseMimeType === "application/json") {
        const system = body.systemInstruction?.parts?.map((p) => p.text).join("\n") ?? "";
        const catalog = system.match(/CATALOG:\n(.+)$/s)?.[1];
        const schema = system.match(/RESPONSE_SCHEMA: (\w+)/)?.[1];
        const brain = {
          layers: { keyPoints: ["Probation is 60 days", "Laptops ship on day one"], summary: "Onboarding summary.", insights: ["Start IT setup earlier"] },
          conflicts: { conflicts: [{ pair: 1, issue: "Different probation length", quoteA: "60 days", quoteB: "90 days", suggestion: "Update the older page" }] },
          retro: { title: "Retro: stub", retrospective: "It went fine.", lessons: ["Order laptops early"], decisions: [{ title: "Use vendor A", reason: "Faster delivery", alternatives: ["Vendor B"] }], process: ["Order", "Configure", "Hand over"], knowledgeNote: "Keep a checklist." },
        }[schema];
        const projectId = catalog ? JSON.parse(catalog)[0]?.id : undefined;
        const json = brain
          ? brain
          : catalog
          ? { widgets: [
              { title: "Tasks by status", type: "pie", projectId, dimensionFieldId: "sys_status", aggregation: "count" },
              { title: "Hours by assignee", type: "bar", projectId, dimensionFieldId: "sys_assignees", measureFieldId: "sys_estimate", aggregation: "sum" },
              { title: "Made-up field", type: "bar", projectId, dimensionFieldId: "sys_nope", aggregation: "count" },
            ] }
          : { items: [{ title: "Draft the checklist", estimateHours: 2, note: "" }, { title: "Review with the manager", estimateHours: 1, note: "30 min" }] };
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(json) }] } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 } }));
      }
      const system = body.systemInstruction?.parts?.map((p) => p.text).join("\n") ?? "";
      // Ask My Brain: cite the first source when there is one.
      const brainAnswer = system.includes("SOURCES:") ? (/\n\[S1\] [A-Z]+:/.test(system) ? `Answer from the brain [S1]. You asked: ${userText}` : `No source covers this. You asked: ${userText}`) : null;
      const answer = brainAnswer ?? (hasFile ? "Extracted text from the PDF: leave policy is 12 days per year." : ["# Stub report", "", `You asked: ${userText}`, "", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
      if (req.url.includes(":streamGenerateContent")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const pieces = answer.match(/.{1,12}/gs) ?? [""];
        for (const p of pieces) res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: p }] } }] })}\r\n\r\n`);
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 111, candidatesTokenCount: 22 } })}\r\n\r\n`);
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: answer }] } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 } }));
    });
  })
  .listen(port, () => console.log(`gemini stub on ${port}`));
