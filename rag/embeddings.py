"""
Embedding local de demonstração.

Não substitui OpenAI/Voyage em qualidade, mas implementa a MESMA
interface: texto entra, vetor de números sai. Isso permite rodar o
pipeline inteiro (chunk → embed → Chroma → cosine similarity) sem API.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Any

from llama_index.core.embeddings import BaseEmbedding


class HashingEmbedding(BaseEmbedding):
    """Converte texto em vetor via n-gramas com hashing trick.

    Ideia (a mesma dos embeddings de verdade, só que mais tosca):

    1. Normalizamos o texto e extraímos n-gramas de caracteres.
    2. Cada n-grama é hasheado para uma posição do vetor.
    3. Normalizamos L2 o vetor resultante.

    Textos que compartilham vocabulário/n-gramas apontam para direções
    parecidas no espaço vetorial. A busca semântica (cosine similarity)
    então encontra os chunks mais próximos da pergunta.

    Embeddings neurais (OpenAI, Voyage) capturam sinônimos e contexto;
    este hashing só captura sobreposição lexical. Por isso o modo demo
    funciona melhor quando a pergunta usa palavras que realmente
    aparecem nos documentos.
    """

    embed_dim: int = 384
    ngram_size: int = 3

    def __init__(
        self,
        embed_dim: int = 384,
        ngram_size: int = 3,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.embed_dim = embed_dim
        self.ngram_size = ngram_size

    def _ngrams(self, text: str) -> list[str]:
        normalized = re.sub(r"\s+", " ", (text or "").lower()).strip()
        if not normalized:
            return []
        padded = f"  {normalized}  "
        size = self.ngram_size
        return [padded[i : i + size] for i in range(len(padded) - size + 1)]

    def _embed(self, text: str) -> list[float]:
        vector = [0.0] * self.embed_dim
        grams = self._ngrams(text)
        if not grams:
            return vector

        for gram in grams:
            digest = hashlib.md5(gram.encode("utf-8")).hexdigest()
            hashed = int(digest, 16)
            index = hashed % self.embed_dim
            sign = 1.0 if ((hashed // self.embed_dim) % 2 == 0) else -1.0
            vector[index] += sign

        # Sem a normalização L2, a similaridade de cosseno deixa de
        # medir "direção" e passa a ser influenciada pelo tamanho do texto.
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]

    def _get_query_embedding(self, query: str) -> list[float]:
        return self._embed(query)

    def _get_text_embedding(self, text: str) -> list[float]:
        return self._embed(text)

    def _get_text_embeddings(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(text) for text in texts]

    async def _aget_query_embedding(self, query: str) -> list[float]:
        return self._get_query_embedding(query)

    async def _aget_text_embedding(self, text: str) -> list[float]:
        return self._get_text_embedding(text)
