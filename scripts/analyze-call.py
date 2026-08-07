#!/usr/bin/env python3
"""
Analizador de llamadas AngaFlow Voice Bot.

Parsea el output de `wrangler tail --format=json` y reconstruye la
transcripción cronológica de una llamada:
  - Bot: lo que dijo el asistente
  - Usuario: SpeechResult crudo de Twilio + confidence
  - Meta: dialog state, missingSlots, RAG hits, reprompts

Uso:
  python3 scripts/analyze-call.py /tmp/wrangler-tail-call.log
  python3 scripts/analyze-call.py /tmp/wrangler-tail-call.log <callSid>
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def parse_events(path: Path):
    """Wrangler tail escribe objetos JSON pretty-printed concatenados."""
    content = path.read_text()
    decoder = json.JSONDecoder()
    events, i = [], 0
    while i < len(content):
        while i < len(content) and content[i] in " \n\r\t":
            i += 1
        if i >= len(content):
            break
        try:
            obj, end = decoder.raw_decode(content[i:])
            events.append(obj)
            i += end
        except json.JSONDecodeError:
            i += 1
    return events


def extract_logs(ev):
    """Retorna lista de dicts parseados de logs.message."""
    result = []
    for L in ev.get("logs", []) or []:
        parts = L.get("message", [])
        if not isinstance(parts, list):
            continue
        for p in parts:
            s = str(p)
            if not s.startswith("{"):
                continue
            try:
                result.append(json.loads(s))
            except json.JSONDecodeError:
                pass
    return result


def ts_str(ms):
    if not ms:
        return "??:??:??"
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone().strftime("%H:%M:%S")


def main():
    if len(sys.argv) < 2:
        print("Uso: analyze-call.py <log-file> [callSid]", file=sys.stderr)
        sys.exit(1)

    path = Path(sys.argv[1])
    target_sid = sys.argv[2] if len(sys.argv) >= 3 else None

    events = parse_events(path)
    print(f"Total events parsed: {len(events)}\n")

    # Agrupar por callSid
    calls = {}  # sid -> list of (ts, log_dict, event_url)
    for ev in events:
        req = ev.get("event", {}).get("request", {})
        url = req.get("url", "")
        if "/webhook/voice" not in url:
            continue
        ts = ev.get("eventTimestamp", 0)
        for log in extract_logs(ev):
            sid = log.get("callSid")
            if not sid:
                continue
            calls.setdefault(sid, []).append((ts, log, url))

    if not calls:
        print("No hay llamadas en este log.")
        return

    print(f"CallSids encontrados: {len(calls)}")
    for sid, entries in calls.items():
        first_ts = min(e[0] for e in entries)
        print(f"  {sid} — {ts_str(first_ts)} — {len(entries)} logs")

    # Elegir la última llamada si no se especificó
    if not target_sid:
        target_sid = sorted(calls.keys(), key=lambda s: min(e[0] for e in calls[s]))[-1]
        print(f"\nAnalizando la más reciente: {target_sid}\n")

    if target_sid not in calls:
        print(f"CallSid {target_sid} no encontrado.")
        return

    entries = sorted(calls[target_sid], key=lambda x: x[0])

    print("=" * 80)
    print(f"TRANSCRIPCIÓN — {target_sid}")
    print("=" * 80)

    turn_num = 0
    for ts, log, url in entries:
        msg = log.get("message", "")
        t = ts_str(ts)

        if msg == "call started":
            print(f"\n[{t}] LLAMADA INICIADA")
            print(f"  From: {log.get('from')}  To: {log.get('to')}")
            print(f"  Tenant: {log.get('tenantId')}")
            print(f"  🤖 BOT: {log.get('botResponse', '')}")

        elif msg == "twilio speech captured":
            conf = log.get("confidence")
            conf_str = f"{conf:.2f}" if isinstance(conf, (int, float)) else "?"
            print(f"\n[{t}] 👤 USUARIO ({conf_str}): \"{log.get('speechResult', '')}\"")

        elif msg == "voice turn":
            turn_num += 1
            state = log.get("state")
            missing = log.get("missingSlots", [])
            complete = log.get("complete")
            bot = log.get("botResponse", "")
            marker = "✅ COMPLETE" if complete else f"→ {state}"
            print(f"[{t}] TURN {turn_num} {marker}  missing={missing}")
            if bot:
                print(f"  🤖 BOT: {bot}")

        elif msg == "voice turn: reprompt":
            reason = log.get("reason")
            conf = log.get("confidence")
            print(f"[{t}] ⚠️  REPROMPT ({reason}, confidence={conf})")

        elif msg.startswith("rag:"):
            origin = log.get("origin", log.get("count", ""))
            top = log.get("top", "")
            print(f"  [{msg}] origin/top={origin}/{top}")

        elif msg == "runtime config resolved":
            pass  # ruido — ya se muestra en call started

        else:
            # Otro log útil (errores, warnings)
            keys = {k: v for k, v in log.items() if k not in ("callSid", "message")}
            if keys:
                print(f"  [{msg}] {json.dumps(keys, ensure_ascii=False)[:200]}")

    print("\n" + "=" * 80)
    print("ANÁLISIS DE PROBLEMAS")
    print("=" * 80)

    speech_captured = [l for _, l, _ in entries if l.get("message") == "twilio speech captured"]
    reprompts = [l for _, l, _ in entries if l.get("message") == "voice turn: reprompt"]
    turns = [l for _, l, _ in entries if l.get("message") == "voice turn"]

    print(f"\nSpeech captures: {len(speech_captured)}")
    print(f"Turns procesados: {len(turns)}")
    print(f"Reprompts: {len(reprompts)}")

    if reprompts:
        print("\n⚠️  Reprompts detectados (Twilio no reconoció o confidence bajo):")
        for r in reprompts:
            print(f"  - reason={r.get('reason')}, confidence={r.get('confidence')}")

    # Detectar loops (mismo state 2+ veces seguidas)
    states = [t.get("state") for t in turns]
    for i in range(1, len(states)):
        if states[i] == states[i - 1] and states[i] in ("confirming", "answering_question"):
            print(f"\n🔁 Loop detectado: turn {i} y {i+1} ambos en state '{states[i]}'")

    # Transcripciones sospechosas (posibles "sí" mal transcrito)
    ambiguous = ["cinco", "sirve", "simón", "asís", "sí sí", "ah sí", "así"]
    for sc in speech_captured:
        text = (sc.get("speechResult") or "").lower()
        for a in ambiguous:
            if a in text:
                print(f"\n🎯 Transcripción sospechosa: \"{text}\" — quizás era \"sí\"")
                break


if __name__ == "__main__":
    main()
