"""
Etapa 4 — Geração.

O LLM NÃO pesquisa seus PDFs. Ele só recebe o que o retrieval escolheu.

Fluxo desta etapa:
1. Montamos um prompt com a pergunta + os chunks recuperados.
2. Pedimos ao modelo para responder SÓ com base nesse contexto.
3. Se não houver chave de API, geramos uma resposta extractiva local
   (útil para demonstrar o pipeline sem gastar tokens).

Essa separação é o coração do RAG:
- Retrieval = "o que ler"
- Geração  = "como escrever a resposta a partir do que foi lido"
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from openai import OpenAI

from rag.config import load_providers
from rag.retrieve import RetrievedChunk

SYSTEM_PROMPT = """Você é um assistente de RAG educacional.
Responda à pergunta do usuário usando APENAS o contexto recuperado dos documentos.
Se o contexto não contiver a resposta, diga claramente que a informação não está nos documentos.
Cite a fonte (nome do arquivo) quando usar um trecho.
Seja direto, preciso e em português."""


def build_prompt(query: str, chunks: list[RetrievedChunk]) -> str:
    """Mostra exatamente o que o LLM vai ler — ótimo para o portfólio.

    No Streamlit este prompt aparece num expander para você ver a
    fronteira retrieval → geração com os próprios olhos.
    """
    if not chunks:
        context = "(nenhum trecho recuperado)"
    else:
        parts = []
        for i, chunk in enumerate(chunks, start=1):
            score = f"{chunk.score:.3f}" if chunk.score is not None else "?"
            parts.append(
                f"[Trecho {i} | fonte: {chunk.source} | score: {score}]\n{chunk.text}"
            )
        context = "\n\n".join(parts)

    return (
        "Contexto recuperado dos documentos:\n"
        f"{context}\n\n"
        f"Pergunta: {query}\n\n"
        "Resposta:"
    )


@dataclass
class GenerationResult:
    answer: str
    prompt: str
    provider: str
    model: str


def _extractive_answer(query: str, chunks: list[RetrievedChunk]) -> str:
    """Fallback sem LLM: escolhe frases dos chunks que mais cruzam com a pergunta.

    Não é um modelo generativo. Serve para:
    - Rodar o app no modo demonstração
    - Mostrar que a qualidade da resposta depende do retrieval
    """
    if not chunks:
        return (
            "Nenhum trecho foi recuperado. Ingira documentos e tente de novo. "
            "(Modo demonstração — sem LLM.)"
        )

    query_terms = {term for term in re.findall(r"\w+", query.lower()) if len(term) > 3}
    selected: list[str] = []

    for chunk in chunks:
        sentences = re.split(r"(?<=[.!?])\s+", chunk.text)
        ranked = []
        for sentence in sentences:
            terms = {term for term in re.findall(r"\w+", sentence.lower()) if len(term) > 3}
            overlap = len(query_terms & terms)
            if overlap:
                ranked.append((overlap, sentence.strip()))
        ranked.sort(key=lambda item: item[0], reverse=True)
        best = [sentence for _, sentence in ranked[:2] if sentence]
        if not best:
            best = [chunk.text.strip()[:400]]
        selected.append(
            f"**Fonte: {chunk.source}**"
            + (f" (score {chunk.score:.3f})" if chunk.score is not None else "")
            + "\n"
            + " ".join(best)
        )

    header = (
        "Resposta em **modo demonstração** (sem LLM). "
        "Os trechos abaixo foram escolhidos pelo retrieval e recortados "
        "por sobreposição de palavras com a pergunta. Com uma API de LLM, "
        "esta etapa reescreveria o mesmo contexto numa resposta fluida.\n"
    )
    return header + "\n\n".join(selected)


def generate(query: str, chunks: list[RetrievedChunk]) -> GenerationResult:
    """Chama o LLM (ou o fallback extractivo) com o prompt montado."""
    prompt = build_prompt(query, chunks)
    providers = load_providers()

    if providers.llm_provider == "xai":
        client = OpenAI(
            api_key=providers.xai_api_key,
            base_url="https://api.x.ai/v1",
        )
        completion = client.chat.completions.create(
            model=providers.xai_llm_model,
            temperature=0.2,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
        )
        answer = completion.choices[0].message.content or ""
        return GenerationResult(
            answer=answer.strip(),
            prompt=prompt,
            provider="xai",
            model=providers.xai_llm_model,
        )

    if providers.llm_provider == "openai":
        client = OpenAI(api_key=providers.openai_api_key)
        completion = client.chat.completions.create(
            model=providers.openai_llm_model,
            temperature=0.2,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
        )
        answer = completion.choices[0].message.content or ""
        return GenerationResult(
            answer=answer.strip(),
            prompt=prompt,
            provider="openai",
            model=providers.openai_llm_model,
        )

    return GenerationResult(
        answer=_extractive_answer(query, chunks),
        prompt=prompt,
        provider="mock",
        model="extractive-fallback",
    )
