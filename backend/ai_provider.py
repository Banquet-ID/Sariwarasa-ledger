import base64
import os

SYSTEM_MESSAGE = "Anda adalah mesin ekstraksi data keuangan. Selalu jawab dengan JSON valid saja."


async def extract_receipt(image_bytes: bytes, mime_type: str, prompt: str) -> str:
    provider = os.environ.get("AI_PROVIDER", "openai")
    if provider == "openai":
        return await _openai_extract(image_bytes, mime_type, prompt)
    raise RuntimeError(f"AI provider '{provider}' tidak didukung")


async def _openai_extract(image_bytes: bytes, mime_type: str, prompt: str) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY belum diset di environment variables backend")
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)
    model = os.environ.get("AI_MODEL", "gpt-4o")
    b64 = base64.b64encode(image_bytes).decode()
    resp = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_MESSAGE},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
                ],
            },
        ],
    )
    return resp.choices[0].message.content
