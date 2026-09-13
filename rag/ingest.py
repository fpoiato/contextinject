"""
Etapa 1 — Ingestão.

Lê PDFs, TXT e Markdown do disco e devolve Documentos do LlamaIndex.
Ainda NÃO criamos embeddings aqui: só carregamos texto bruto e metadados
(fonte do arquivo, tipo). Separar ingestão de indexação deixa o pipeline
fácil de testar e de explicar.
"""

from __future__ import annotations

from pathlib import Path

from llama_index.core import Document, SimpleDirectoryReader

from rag.config import RAW_DIR, SAMPLE_DIR

SUPPORTED_EXTS = [".pdf", ".txt", ".md"]


def list_source_files(directory: Path) -> list[Path]:
    """Lista arquivos que o leitor sabe processar.

    README.md da pasta data/raw/ é documentação do repositório, não acervo.
    """
    if not directory.exists():
        return []
    skipped = {"readme.md", ".gitkeep"}
    files: list[Path] = []
    for ext in SUPPORTED_EXTS:
        files.extend(sorted(directory.glob(f"*{ext}")))
    return [path for path in files if path.name.lower() not in skipped]


def resolve_input_dir(input_dir: Path | None = None) -> Path:
    """Usa data/raw se houver arquivos; senão cai nos exemplos de data/sample."""
    if input_dir is not None:
        return input_dir

    raw_files = list_source_files(RAW_DIR)
    if raw_files:
        return RAW_DIR
    return SAMPLE_DIR


def load_documents(input_dir: Path | None = None) -> list[Document]:
    """Carrega documentos de uma pasta.

    SimpleDirectoryReader do LlamaIndex:
    - .txt / .md → lê o texto direto
    - .pdf      → extrai páginas com pypdf

    Cada Document guarda o texto completo + metadata (file_name, file_path).
    O corte em chunks acontece na etapa seguinte (indexação), não aqui.
    """
    directory = resolve_input_dir(input_dir)
    if not directory.exists():
        raise FileNotFoundError(
            f"Pasta de documentos não encontrada: {directory}. "
            "Crie data/raw/ e coloque PDFs ou .txt lá."
        )

    files = list_source_files(directory)
    if not files:
        raise FileNotFoundError(
            f"Nenhum PDF/TXT/MD em {directory}. "
            "Adicione arquivos em data/raw/ ou use os exemplos em data/sample/."
        )

    reader = SimpleDirectoryReader(
        input_files=[str(path) for path in files],
        filename_as_id=True,
    )
    documents = reader.load_data()

    # Metadados extras ajudam a citar a fonte na hora da geração.
    for document in documents:
        source = document.metadata.get("file_name") or document.metadata.get("file_path")
        document.metadata["source"] = source
        document.metadata["input_dir"] = str(directory)

    return documents
