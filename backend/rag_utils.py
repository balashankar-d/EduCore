import os
import pdfplumber
import uuid
import hashlib
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.embeddings import HuggingFaceEmbeddings
from langchain.vectorstores import Chroma
from langchain.llms import OpenAI
from langchain.chains import RetrievalQA, ConversationalRetrievalChain

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
CHROMA_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")

def process_pdf_and_store(pdf_filename, collection_name="notes"):
    """
    Extracts text from a PDF, chunks it, embeds it, and stores in ChromaDB with metadata.
    Avoids duplicate chunks using content hash as doc_id, checks for existing doc_ids in DB.
    Skips pages with errors but processes others.
    """
    pdf_path = os.path.join(UPLOAD_FOLDER, pdf_filename)
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"{pdf_path} does not exist.")

    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    vectordb = Chroma(
        collection_name,
        embedding_function=embeddings,
        persist_directory=CHROMA_DIR
    )

    # Fetch all existing doc_ids once for fast deduplication
    try:
        existing = vectordb.get(include=["metadatas"])
        existing_ids = {m["doc_id"] for m in existing["metadatas"] if m and "doc_id" in m}
    except Exception:
        existing_ids = set()

    docs = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages, start=1):
                try:
                    text = page.extract_text() or ""
                except Exception as page_err:
                    print(f"Warning: Could not parse page {page_num} in {pdf_filename}: {page_err}")
                    continue
                if not text.strip():
                    continue
                page_chunks = splitter.create_documents([text])
                for chunk_idx, chunk in enumerate(page_chunks):
                    # Use hash of chunk content as doc_id
                    doc_id = hashlib.sha256(chunk.page_content.encode('utf-8')).hexdigest()
                    if doc_id in existing_ids:
                        continue
                    chunk.metadata = {
                        "source": pdf_filename,
                        "page": page_num,
                        "chunk": chunk_idx,
                        "doc_id": doc_id
                    }
                    docs.append(chunk)
    except Exception as e:
        raise RuntimeError(f"Failed to process PDF: {e}")

    if not docs:
        raise ValueError("No new extractable text found in PDF.")

    vectordb.add_documents(docs)
    vectordb.persist()
    return True

def answer_query(query, chat_history=None, collection_name="notes", top_k=5):
    """
    Answers a question using RAG: retrieves relevant chunks and uses LLM for answer.
    Includes chat history and a system prompt for concise, context-based answers.
    """
    embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    vectordb = Chroma(
        collection_name,
        embedding_function=embeddings,
        persist_directory=CHROMA_DIR
    )
    retriever = vectordb.as_retriever(
        search_type="similarity",  # or "mmr" for diversity
        search_kwargs={"k": top_k}
    )

    system_prompt = (
        "You are an educational assistant. Use the provided context from uploaded notes and the ongoing chat history "
        "to answer questions concisely and accurately. If the answer is not in the context, say you don't know. "
        "Always cite the source file and page number if relevant. Do not hallucinate."
    )

    llm = OpenAI(
        temperature=0.2,
        model_kwargs={"system_prompt": system_prompt}
    )

    chat_history = chat_history or []

    qa = ConversationalRetrievalChain.from_llm(
        llm=llm,
        retriever=retriever,
        return_source_documents=True
    )
    result = qa({"question": query, "chat_history": chat_history})

    sources = []
    for doc in result["source_documents"]:
        meta = doc.metadata
        sources.append(f"{meta.get('source', 'unknown')} (page {meta.get('page', '?')})")
    sources_str = "; ".join(set(sources))

    answer = result["answer"]
    if sources_str:
        answer += f"\n\nSources: {sources_str}"

    return answer
