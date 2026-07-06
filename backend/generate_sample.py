"""Genera un MP3 corto de muestra con la voz Catalina.

Corré esto en tu Mac después del `pip install -r requirements.txt`. Crea
`sample_catalina.mp3` en el mismo directorio.
"""
import asyncio
import edge_tts


TEXT = (
    "Bienvenido a Tormenta de Ideas. Tu primera idea quedó guardada. "
    "Cuando marques un avance sobre ella, prepararé un episodio de podcast "
    "de unos diez minutos, investigado en profundidad, y te lo mando por correo. "
    "Estoy lista para empezar cuando quieras."
)


async def main():
    comm = edge_tts.Communicate(TEXT, "es-CL-CatalinaNeural", rate="+5%")
    await comm.save("sample_catalina.mp3")
    print("Listo: sample_catalina.mp3")


if __name__ == "__main__":
    asyncio.run(main())
