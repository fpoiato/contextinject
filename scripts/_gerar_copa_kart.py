"""Gera JSON e artigos mensais da Copa Traçado a partir de campeonato_kart.csv."""

from __future__ import annotations

import csv
import hashlib
import json
import random
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "campeonato_kart.csv"
OUT_JSON = ROOT / "data" / "raw" / "campeonato_kart.json"
OUT_ARTIGOS = ROOT / "data" / "raw" / "artigos"

PONTOS = {
    1: 40,
    2: 32,
    3: 26,
    4: 14,
    5: 12,
    6: 10,
    7: 8,
    8: 6,
    9: 4,
    10: 3,
    11: 2,
}

MESES = {
    1: "janeiro",
    2: "fevereiro",
    3: "março",
    4: "abril",
    5: "maio",
    6: "junho",
    7: "julho",
    8: "agosto",
    9: "setembro",
    10: "outubro",
    11: "novembro",
    12: "dezembro",
}

CORES = [
    "vermelho",
    "azul",
    "amarelo",
    "verde",
    "branco",
    "preto",
    "laranja",
    "roxo",
    "cinza",
    "ciano",
    "vinho",
    "prata",
    "dourado",
    "lima",
    "azul-marinho",
]


def pontos_por_posicao(posicao: int | None, presente: bool, desclassificado: bool) -> int:
    if not presente or desclassificado:
        return 0
    if posicao is None:
        return 1
    return PONTOS.get(posicao, 1)


def lastro_kg(peso: float) -> float:
    if peso >= 100.0:
        return 0.0
    return round(100.0 - peso, 1)


def parse_tempo(texto: str | None) -> float | None:
    if not texto:
        return None
    partes = texto.split(":")
    if len(partes) != 2:
        return None
    return int(partes[0]) * 60.0 + float(partes[1])


def fmt_tempo(segundos: float | None) -> str | None:
    if segundos is None:
        return None
    if segundos < 0:
        segundos = 0.0
    minutos, resto = divmod(segundos, 60.0)
    return f"{int(minutos):02d}:{resto:06.3f}"


def calendario() -> list[date]:
    blocos = [
        (date(2024, 1, 6), 16),
        (date(2025, 1, 4), 14),
        (date(2026, 4, 11), 12),
    ]
    datas: list[date] = []
    for inicio, n in blocos:
        assert inicio.weekday() == 5, inicio
        for i in range(n):
            d = inicio + timedelta(days=14 * i)
            assert d.weekday() == 5, d
            datas.append(d)
    assert len(datas) == 42
    assert datas[0] == date(2024, 1, 6)
    assert datas[-1] == date(2026, 9, 12)
    return datas


def temporada_de(d: date) -> int:
    return d.year


def stable_rand(*parts: object) -> random.Random:
    h = hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return random.Random(int(h[:16], 16))


def ler_csv() -> tuple[dict[int, dict], dict[int, str], list[dict]]:
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f, delimiter=";"))

    corridas: dict[int, dict] = {}
    nomes: dict[int, str] = {}
    for r in rows:
        rid = int(r["corridaId"])
        if rid not in corridas:
            corridas[rid] = {
                "id": rid,
                "local": r["local"],
                "sentido": r["sentido"],
                "extensao_m": float(r["extensao"]),
            }
        pid = int(r["pilotoId"])
        nomes[pid] = r["nome"]
    return corridas, nomes, rows


def montar_pilotos(nomes: dict[int, str], rows: list[dict]) -> list[dict]:
    medias: dict[int, float] = {}
    for pid in nomes:
        posicoes = [
            int(r["posicao"])
            for r in rows
            if int(r["pilotoId"]) == pid and r["posicao"]
        ]
        medias[pid] = sum(posicoes) / len(posicoes) if posicoes else 20.0

    combinacoes: list[list[str]] = []
    for a in range(len(CORES)):
        for b in range(len(CORES)):
            for c in range(len(CORES)):
                if len({a, b, c}) == 3:
                    combinacoes.append([CORES[a], CORES[b], CORES[c]])
    rng_cores = random.Random(20240914)
    rng_cores.shuffle(combinacoes)

    pesados = {26, 14, 21}

    pilotos = []
    for i, pid in enumerate(sorted(nomes)):
        rng = stable_rand("piloto", pid)
        media = medias[pid]
        if pid in pesados:
            peso = round(rng.uniform(101.2, 108.4), 1)
        else:
            base = 69.0 + (media - 8.0) * 1.15
            peso = round(min(99.6, max(62.4, base + rng.uniform(-3.5, 3.5))), 1)
        lastro = lastro_kg(peso)
        idade = int(round(min(47, max(18, 22 + media * 0.55 + rng.uniform(-4, 5)))))
        cores = combinacoes[i]
        pilotos.append(
            {
                "id": pid,
                "nome": nomes[pid],
                "idade": idade,
                "cores": cores,
                "peso_kg": peso,
                "lastro_kg": lastro,
                "peso_conjunto_kg": round(peso + lastro, 1),
            }
        )
    return pilotos


def sintetizar_dnf(row: dict, classificados: list[dict], rng: random.Random) -> dict:
    voltas_ref = [int(r["numeroVoltas"]) for r in classificados if r["numeroVoltas"]]
    tempos = [parse_tempo(r["tempoTotal"]) for r in classificados]
    melhores = [parse_tempo(r["melhorVolta"]) for r in classificados]
    n_voltas_prova = max(voltas_ref) if voltas_ref else 24
    melhor_ref = min(t for t in melhores if t) if any(melhores) else 50.0
    voltas = max(3, int(n_voltas_prova * rng.uniform(0.28, 0.72)))
    melhor = round(melhor_ref * rng.uniform(1.01, 1.08), 3)
    tempo = voltas * melhor * rng.uniform(1.01, 1.06)
    return {
        "numeroVoltas": str(voltas),
        "melhorVolta": fmt_tempo(melhor),
        "tempoTotal": fmt_tempo(tempo),
    }


def montar_resultados(rows: list[dict]) -> dict[int, list[dict]]:
    por_corrida: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        por_corrida[int(r["corridaId"])].append(r)

    saida: dict[int, list[dict]] = {}
    for rid, lista in por_corrida.items():
        classificados = [r for r in lista if r["posicao"]]
        resultados = []
        for r in lista:
            pid = int(r["pilotoId"])
            presente = r["presente"].lower() == "true"
            rng = stable_rand("resultado", rid, pid)
            pole = r["polePosition"] == "True"
            if not presente:
                resultados.append(
                    {
                        "pilotoId": pid,
                        "presente": False,
                        "status": "ausente",
                        "posicao": None,
                        "tempoTotal": None,
                        "numeroVoltas": None,
                        "melhorVolta": None,
                        "polePosition": False,
                        "bandeira": None,
                        "incidente": None,
                        "trocaDeCarro": False,
                        "quebra": False,
                        "pontos": 0,
                    }
                )
                continue

            vazio = not r["posicao"]
            desclassificado = False
            quebra = False
            troca = False
            bandeira = None
            posicao = int(r["posicao"]) if r["posicao"] else None
            tempo = r["tempoTotal"] or None
            voltas = int(r["numeroVoltas"]) if r["numeroVoltas"] else None
            melhor = r["melhorVolta"] or None

            if vazio:
                extra = sintetizar_dnf(r, classificados, rng)
                tempo = extra["tempoTotal"]
                voltas = int(extra["numeroVoltas"])
                melhor = extra["melhorVolta"]
                if rng.random() < 0.38:
                    desclassificado = True
                    bandeira = "preta"
                    status = "desclassificado"
                    incidente = "desclassificacao"
                else:
                    quebra = True
                    status = "nao_completou"
                    incidente = "quebra"
                    if rng.random() < 0.35:
                        troca = True
                        incidente = "quebra_apos_troca_de_carro"
            else:
                status = "classificado"
                incidente = None
                if rng.random() < 0.07:
                    bandeira = "preta_e_branca"
                    incidente = "advertencia"
                if rng.random() < 0.05:
                    troca = True
                    incidente = "troca_de_carro" if incidente is None else f"{incidente}+troca_de_carro"

            pontos = pontos_por_posicao(posicao, True, desclassificado)
            resultados.append(
                {
                    "pilotoId": pid,
                    "presente": True,
                    "status": status,
                    "posicao": posicao,
                    "tempoTotal": tempo,
                    "numeroVoltas": voltas,
                    "melhorVolta": melhor,
                    "polePosition": pole,
                    "bandeira": bandeira,
                    "incidente": incidente,
                    "trocaDeCarro": troca,
                    "quebra": quebra,
                    "pontos": pontos,
                }
            )
        resultados.sort(key=lambda x: (x["posicao"] is None, x["posicao"] or 99, x["pilotoId"]))
        saida[rid] = resultados
    return saida


def montar_grid(resultados: list[dict]) -> dict[int, int]:
    pole = next((r for r in resultados if r["polePosition"] and r["presente"]), None)
    demais = [
        r
        for r in resultados
        if r["presente"] and r["melhorVolta"] and not (pole and r["pilotoId"] == pole["pilotoId"])
    ]
    demais.sort(key=lambda r: parse_tempo(r["melhorVolta"]) or 9999)
    ordem = []
    if pole:
        ordem.append(pole["pilotoId"])
    ordem.extend(r["pilotoId"] for r in demais)
    atras = [
        r["pilotoId"]
        for r in resultados
        if r["presente"] and r["pilotoId"] not in ordem
    ]
    ordem.extend(atras)
    return {pid: i + 1 for i, pid in enumerate(ordem)}


def ultrapassagens(resultados: list[dict]) -> dict[int, int]:
    grid = montar_grid(resultados)
    out = {}
    for r in resultados:
        if r["status"] != "classificado" or r["posicao"] is None:
            out[r["pilotoId"]] = 0
            continue
        g = grid.get(r["pilotoId"], r["posicao"])
        out[r["pilotoId"]] = max(0, g - r["posicao"])
    return out


def montar_corridas(
    meta: dict[int, dict], resultados: dict[int, list[dict]], datas: list[date]
) -> list[dict]:
    corridas = []
    etapa_ano: dict[int, int] = defaultdict(int)
    for idx, rid in enumerate(sorted(meta), start=1):
        d = datas[rid - 1]
        ano = temporada_de(d)
        etapa_ano[ano] += 1
        etapa_t = etapa_ano[ano]
        res = resultados[rid]
        ovt = ultrapassagens(res)
        melhor_volta_piloto = None
        melhor_t = None
        for r in res:
            t = parse_tempo(r["melhorVolta"]) if r["melhorVolta"] else None
            if t is None:
                continue
            if melhor_t is None or t < melhor_t:
                melhor_t = t
                melhor_volta_piloto = r["pilotoId"]
        pole = next(r["pilotoId"] for r in res if r["polePosition"])
        vencedor = next(r["pilotoId"] for r in res if r["posicao"] == 1)
        grid = montar_grid(res)
        for r in res:
            r["ultrapassagens"] = ovt.get(r["pilotoId"], 0)
            r["posicaoGrid"] = grid.get(r["pilotoId"])
        corridas.append(
            {
                "id": f"{ano}-{etapa_t:02d}",
                "etapaTemporada": etapa_t,
                "etapaGeral": idx,
                "temporada": ano,
                "ultimaEtapaTemporada": False,
                "data": d.isoformat(),
                "local": meta[rid]["local"],
                "sentidoPista": meta[rid]["sentido"],
                "extensaoM": meta[rid]["extensao_m"],
                "polePositionPilotoId": pole,
                "vencedorPilotoId": vencedor,
                "melhorVoltaPilotoId": melhor_volta_piloto,
                "melhorVoltaTempo": fmt_tempo(melhor_t),
                "resultados": res,
            }
        )
    return corridas


def _vazio_agg() -> dict:
    return {
        "pontos": 0,
        "vitorias": 0,
        "podios": 0,
        "poles": 0,
        "melhoresVoltas": 0,
        "ultrapassagens": 0,
        "presencas": 0,
        "ausencias": 0,
        "quebras": 0,
        "desclassificacoes": 0,
        "advertencias": 0,
        "trocasDeCarro": 0,
    }


def agregar_temporada(corridas: list[dict]) -> dict[int, dict]:
    agg: dict[int, dict] = defaultdict(_vazio_agg)
    for c in corridas:
        for r in c["resultados"]:
            a = agg[r["pilotoId"]]
            a["pontos"] += r["pontos"]
            if r["presente"]:
                a["presencas"] += 1
            else:
                a["ausencias"] += 1
            if r["posicao"] == 1:
                a["vitorias"] += 1
            if r["posicao"] in (1, 2, 3):
                a["podios"] += 1
            if r["polePosition"]:
                a["poles"] += 1
            if r["pilotoId"] == c["melhorVoltaPilotoId"]:
                a["melhoresVoltas"] += 1
            a["ultrapassagens"] += r.get("ultrapassagens") or 0
            if r["quebra"]:
                a["quebras"] += 1
            if r["bandeira"] == "preta":
                a["desclassificacoes"] += 1
            if r["bandeira"] == "preta_e_branca":
                a["advertencias"] += 1
            if r["trocaDeCarro"]:
                a["trocasDeCarro"] += 1
    return agg


def ranking_agg(agg: dict[int, dict], por_id: dict[int, dict]) -> list[dict]:
    ranking = []
    for pid, a in agg.items():
        p = por_id[pid]
        ranking.append(
            {
                "pilotoId": pid,
                "nome": p["nome"],
                "cores": p["cores"],
                "idade": p["idade"],
                "peso_kg": p["peso_kg"],
                "lastro_kg": p["lastro_kg"],
                **a,
            }
        )
    ranking.sort(key=lambda x: (-x["pontos"], -x["vitorias"], -x["podios"], x["nome"]))
    for i, row in enumerate(ranking, start=1):
        row["posicao"] = i
    return ranking


def lider_destaque(ranking: list[dict], campo: str) -> dict:
    melhor = max(ranking, key=lambda x: (x[campo], -x["pilotoId"]))
    return {
        "pilotoId": melhor["pilotoId"],
        "nome": melhor["nome"],
        campo: melhor[campo],
    }


def montar_especial(ano: int, corridas_ano: list[dict], pilotos: list[dict]) -> dict:
    por_id = {p["id"]: p for p in pilotos}
    agg = agregar_temporada(corridas_ano)
    ranking = ranking_agg(agg, por_id)
    p1, p2, p3 = ranking[0], ranking[1], ranking[2]
    return {
        "temporada": ano,
        "etapaId": corridas_ano[-1]["id"],
        "totalEtapas": len(corridas_ano),
        "podio": [
            {**p1, "titulo": "campeao"},
            {**p2, "titulo": "vice"},
            {**p3, "titulo": "terceiro"},
        ],
        "diferencaCampeaoVice": p1["pontos"] - p2["pontos"],
        "diferencaViceTerceiro": p2["pontos"] - p3["pontos"],
        "destaques": {
            "maisVitorias": lider_destaque(ranking, "vitorias"),
            "maisPoles": lider_destaque(ranking, "poles"),
            "maisMelhoresVoltas": lider_destaque(ranking, "melhoresVoltas"),
            "maisUltrapassagens": lider_destaque(ranking, "ultrapassagens"),
            "maisPresencas": lider_destaque(ranking, "presencas"),
            "maisQuebras": lider_destaque(ranking, "quebras"),
            "maisDesclassificacoes": lider_destaque(ranking, "desclassificacoes"),
            "maisAdvertencias": lider_destaque(ranking, "advertencias"),
        },
        "classificacaoFinal": ranking,
    }


def anexar_especiais(corridas: list[dict], pilotos: list[dict]) -> dict[int, list[dict]]:
    por_ano: dict[int, list[dict]] = defaultdict(list)
    for c in corridas:
        por_ano[c["temporada"]].append(c)
    classificacoes: dict[int, list[dict]] = {}
    for ano, lista in por_ano.items():
        especial = montar_especial(ano, lista, pilotos)
        ultima = lista[-1]
        ultima["ultimaEtapaTemporada"] = True
        ultima["especialTemporada"] = especial
        classificacoes[ano] = especial["classificacaoFinal"]
    return classificacoes


def classificacao(corridas: list[dict], pilotos: list[dict]) -> list[dict]:
    pts = defaultdict(int)
    vitorias = defaultdict(int)
    podios = defaultdict(int)
    presencas = defaultdict(int)
    for c in corridas:
        for r in c["resultados"]:
            pts[r["pilotoId"]] += r["pontos"]
            if r["presente"]:
                presencas[r["pilotoId"]] += 1
            if r["posicao"] == 1:
                vitorias[r["pilotoId"]] += 1
            if r["posicao"] in (1, 2, 3):
                podios[r["pilotoId"]] += 1
    ranking = []
    for p in pilotos:
        ranking.append(
            {
                "pilotoId": p["id"],
                "nome": p["nome"],
                "pontos": pts[p["id"]],
                "vitorias": vitorias[p["id"]],
                "podios": podios[p["id"]],
                "presencas": presencas[p["id"]],
            }
        )
    ranking.sort(key=lambda x: (-x["pontos"], -x["vitorias"], -x["podios"], x["nome"]))
    for i, row in enumerate(ranking, start=1):
        row["posicao"] = i
    return ranking


def br_num(valor: float) -> str:
    texto = f"{valor:.1f}".replace(".", ",")
    if texto.endswith(",0"):
        return texto[:-2]
    return texto


def data_extenso(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} de {MESES[d.month]} de {d.year}"


def cores_txt(cores: list[str]) -> str:
    return f"{cores[0]}, {cores[1]} e {cores[2]}"


def pl(n: int, singular: str, plural: str) -> str:
    return f"{n} {singular if n == 1 else plural}"


def nome_kart(piloto: dict) -> str:
    cores = piloto.get("cores") or []
    if cores:
        return f"{piloto['nome']}, de kart {cores_txt(cores)}"
    return piloto["nome"]


def piloto_especial(row: dict, por_id: dict[int, dict]) -> dict:
    base = por_id[row["pilotoId"]]
    return {**base, **row}


def render_especial(especial: dict, por_id: dict[int, dict]) -> list[str]:
    ano = especial["temporada"]
    etapa_id = especial["etapaId"]
    n = especial["totalEtapas"]
    p1, p2, p3 = especial["podio"]
    d1 = especial["destaques"]
    blocos = [
        f"## Especial de encerramento — Temporada {ano} (etapa {etapa_id})",
        "",
        (
            f"A etapa {etapa_id} fecha a temporada {ano} da Copa Traçado, com "
            f"{pl(n, 'prova', 'provas')}. O ID das etapas desta temporada recomeça em "
            f"{ano}-01 e vai até {etapa_id}."
        ),
        "",
        "### Campeão, vice e terceiro",
        "",
    ]

    def ficha(row: dict, titulo: str) -> str:
        p = piloto_especial(row, por_id)
        return (
            f"**{titulo}: {nome_kart(p)}.** {p['idade']} anos, {br_num(p['peso_kg'])} kg, "
            f"lastro de {br_num(p['lastro_kg'])} kg. Fechou {ano} em {row['posicao']}º na "
            f"temporada, com {pl(row['pontos'], 'ponto', 'pontos')}, "
            f"{pl(row['vitorias'], 'vitória', 'vitórias')}, "
            f"{pl(row['podios'], 'pódio', 'pódios')}, "
            f"{pl(row['poles'], 'pole', 'poles')} e "
            f"{pl(row['melhoresVoltas'], 'melhor volta', 'melhores voltas')}. "
            f"Esteve presente em {pl(row['presencas'], 'etapa', 'etapas')} "
            f"e faltou a {pl(row['ausencias'], 'prova', 'provas')}."
        )

    blocos.append(ficha(p1, "Campeão da temporada"))
    blocos.append(ficha(p2, "Vice-campeão"))
    blocos.append(ficha(p3, "Terceiro colocado"))
    blocos.append("")
    blocos.append(
        f"O título de {ano} ficou definido por {pl(especial['diferencaCampeaoVice'], 'ponto', 'pontos')} "
        f"de {p1['nome']} sobre {p2['nome']}. Entre vice e terceiro, a diferença foi de "
        f"{pl(especial['diferencaViceTerceiro'], 'ponto', 'pontos')} ({p2['nome']} à frente de {p3['nome']})."
    )
    blocos.append("")
    blocos.append("### Destaques da temporada")
    blocos.append("")
    blocos.append(
        f"- Mais vitórias em {ano}: {d1['maisVitorias']['nome']}, com "
        f"{pl(d1['maisVitorias']['vitorias'], 'vitória', 'vitórias')}."
    )
    blocos.append(
        f"- Mais poles em {ano}: {d1['maisPoles']['nome']}, com "
        f"{pl(d1['maisPoles']['poles'], 'pole', 'poles')}."
    )
    blocos.append(
        f"- Mais voltas mais rápidas em {ano}: {d1['maisMelhoresVoltas']['nome']}, com "
        f"{pl(d1['maisMelhoresVoltas']['melhoresVoltas'], 'melhor volta', 'melhores voltas')}."
    )
    blocos.append(
        f"- Rei das ultrapassagens em {ano}: {d1['maisUltrapassagens']['nome']}, com "
        f"{pl(d1['maisUltrapassagens']['ultrapassagens'], 'ultrapassagem', 'ultrapassagens')}."
    )
    blocos.append(
        f"- Melhor presença em {ano}: {d1['maisPresencas']['nome']}, com "
        f"{pl(d1['maisPresencas']['presencas'], 'etapa', 'etapas')} disputadas."
    )
    blocos.append(
        f"- Mais quebras em {ano}: {d1['maisQuebras']['nome']}, com "
        f"{pl(d1['maisQuebras']['quebras'], 'quebra', 'quebras')}."
    )
    blocos.append(
        f"- Mais bandeiras pretas em {ano}: {d1['maisDesclassificacoes']['nome']}, com "
        f"{pl(d1['maisDesclassificacoes']['desclassificacoes'], 'desclassificação', 'desclassificações')}."
    )
    blocos.append(
        f"- Mais bandeiras pretas e brancas em {ano}: {d1['maisAdvertencias']['nome']}, com "
        f"{pl(d1['maisAdvertencias']['advertencias'], 'advertência', 'advertências')}."
    )
    top10 = especial["classificacaoFinal"][:10]
    lista = "; ".join(
        f"{x['posicao']}º {x['nome']} ({x['pontos']} pts, {pl(x['vitorias'], 'vitória', 'vitórias')})"
        for x in top10
    )
    blocos.append("")
    blocos.append(
        f"Classificação final da temporada {ano} (top 10), após a etapa {etapa_id}: {lista}."
    )
    blocos.append("")
    return blocos


def gerar_artigos(data: dict) -> None:
    OUT_ARTIGOS.mkdir(parents=True, exist_ok=True)
    for antigo in OUT_ARTIGOS.glob("copa-tracado-*.md"):
        antigo.unlink()

    por_id = {p["id"]: p for p in data["pilotos"]}
    corridas = data["corridas"]
    por_mes: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for c in corridas:
        d = date.fromisoformat(c["data"])
        por_mes[(d.year, d.month)].append(c)

    acum: dict[int, int] = defaultdict(int)
    acum_temp: dict[tuple[int, int], int] = defaultdict(int)
    temporada_atual = None

    for (ano, mes) in sorted(por_mes):
        etapas = por_mes[(ano, mes)]
        blocos: list[str] = []
        titulo = f"Copa Traçado — Boletim de {MESES[mes]} de {ano}"
        blocos.append(f"# {titulo}")
        blocos.append("")
        blocos.append(
            f"A Revista Traçado fecha o mês de {MESES[mes]} de {ano} da Copa Traçado de Kart "
            f"com {pl(len(etapas), 'etapa disputada', 'etapas disputadas')} "
            f"sempre aos sábados, em ritmo de quinzena. O regulamento de lastro segue o peso de "
            f"referência de 100 kg: o lastro é só a diferença positiva até essa marca; piloto com "
            f"100 kg ou mais corre sem lastro. Quem falta zera a etapa. Quem larga e não leva "
            f"bandeira preta pontua. O pódio leva 40, 32 e 26 pontos — vantagem clara sobre os "
            f"14 do quarto colocado. Bandeira preta desclassifica; preta e branca é advertência. "
            f"O ID das etapas reinicia a cada temporada no formato {ano}-## "
            f"(a primeira prova do ano é {ano}-01)."
        )
        blocos.append("")

        vencedores_mes: list[str] = []
        for corrida in etapas:
            if temporada_atual != corrida["temporada"]:
                temporada_atual = corrida["temporada"]
            grid = {r["pilotoId"]: r.get("posicaoGrid") for r in corrida["resultados"]}
            res_por_id = {r["pilotoId"]: r for r in corrida["resultados"]}
            vencedor = por_id[corrida["vencedorPilotoId"]]
            pole = por_id[corrida["polePositionPilotoId"]]
            mv = por_id[corrida["melhorVoltaPilotoId"]]
            vencedores_mes.append(
                f"etapa {corrida['id']} com {nome_kart(vencedor)}"
            )

            sentido = (
                "sentido horário"
                if "horário" in corrida["sentidoPista"] and "anti" not in corrida["sentidoPista"]
                else "sentido anti-horário"
            )
            blocos.append(
                f"## Etapa {corrida['id']} — {corrida['local']}, {data_extenso(corrida['data'])}"
            )
            blocos.append("")
            blocos.append(
                f"A etapa {corrida['id']} da Copa Traçado, válida pela temporada "
                f"{corrida['temporada']}, foi no {corrida['local']}, pista de "
                f"{br_num(corrida['extensaoM'])} metros, {sentido}. A prova aconteceu no sábado "
                f"{data_extenso(corrida['data'])}. A pole position ficou com {nome_kart(pole)}. "
                f"A vitória foi de {nome_kart(vencedor)}. A melhor volta da corrida foi de "
                f"{nome_kart(mv)}, em {corrida['melhorVoltaTempo']}."
            )
            blocos.append("")

            quebras = [por_id[r["pilotoId"]]["nome"] for r in corrida["resultados"] if r["quebra"]]
            dsq = [
                por_id[r["pilotoId"]]["nome"]
                for r in corrida["resultados"]
                if r["bandeira"] == "preta"
            ]
            adv = [
                por_id[r["pilotoId"]]["nome"]
                for r in corrida["resultados"]
                if r["bandeira"] == "preta_e_branca"
            ]
            trocas = [
                por_id[r["pilotoId"]]["nome"]
                for r in corrida["resultados"]
                if r["trocaDeCarro"]
            ]
            ausentes = [
                por_id[r["pilotoId"]]["nome"]
                for r in corrida["resultados"]
                if not r["presente"]
            ]
            lider_ovt = max(
                corrida["resultados"],
                key=lambda r: (r["ultrapassagens"], -r["pilotoId"]),
            )

            if quebras:
                blocos.append(
                    f"Quebras mecânicas nesta etapa: {', '.join(quebras)}. Esses pilotos largaram, "
                    f"não completaram a distância e ainda assim pontuaram 1 ponto pela presença na prova."
                )
            else:
                blocos.append("Nenhuma quebra mecânica foi registrada nesta etapa.")
            if trocas:
                blocos.append(f"Troca de kart: {', '.join(trocas)}.")
            else:
                blocos.append("Ninguém precisou trocar de kart nesta etapa.")
            if dsq:
                blocos.append(
                    f"Bandeira preta (desclassificação, zero ponto): {', '.join(dsq)}."
                )
            else:
                blocos.append("A direção de prova não mostrou bandeira preta.")
            if adv:
                blocos.append(
                    f"Bandeira preta e branca (advertência, o piloto seguiu pontuando): {', '.join(adv)}."
                )
            else:
                blocos.append("Não houve bandeira preta e branca.")
            if ausentes:
                blocos.append(
                    f"Não compareceram e zeraram a etapa: {', '.join(ausentes)}."
                )
            else:
                blocos.append("Os 30 inscritos compareceram.")
            blocos.append(
                f"O piloto que mais ultrapassou na etapa {corrida['id']} foi "
                f"{nome_kart(por_id[lider_ovt['pilotoId']])}: "
                f"{pl(lider_ovt['ultrapassagens'], 'ultrapassagem', 'ultrapassagens')}, "
                f"saindo da {lider_ovt.get('posicaoGrid')}ª posição no grid."
            )
            blocos.append("")
            blocos.append("### Cada piloto na etapa")
            blocos.append("")

            ordem = sorted(
                corrida["resultados"],
                key=lambda r: (
                    0 if r["posicao"] else 1,
                    r["posicao"] or 99,
                    0 if r["presente"] else 1,
                    r["pilotoId"],
                ),
            )
            for r in ordem:
                p = por_id[r["pilotoId"]]
                acum[p["id"]] += r["pontos"]
                acum_temp[(corrida["temporada"], p["id"])] += r["pontos"]
                peso = (
                    f"{p['idade']} anos, {br_num(p['peso_kg'])} kg, lastro de "
                    f"{br_num(p['lastro_kg'])} kg (conjunto {br_num(p['peso_conjunto_kg'])} kg)"
                )
                if not r["presente"]:
                    frase = (
                        f"{nome_kart(p)} ({peso}) não compareceu à etapa {corrida['id']} "
                        f"em {corrida['local']}. Pontos na etapa: 0. "
                        f"Acumulado após esta etapa: {pl(acum[p['id']], 'ponto', 'pontos')} na Copa Traçado "
                        f"e {pl(acum_temp[(corrida['temporada'], p['id'])], 'ponto', 'pontos')} "
                        f"na temporada {corrida['temporada']}."
                    )
                elif r["status"] == "desclassificado":
                    frase = (
                        f"{nome_kart(p)} ({peso}) levou bandeira preta e foi desclassificado. "
                        f"Chegou a cumprir {pl(r['numeroVoltas'] or 0, 'volta', 'voltas')}, "
                        f"tempo {r['tempoTotal']}, melhor volta {r['melhorVolta']}. "
                        f"Pontos na etapa: 0. "
                        f"Acumulado após esta etapa: {pl(acum[p['id']], 'ponto', 'pontos')} na Copa Traçado "
                        f"e {pl(acum_temp[(corrida['temporada'], p['id'])], 'ponto', 'pontos')} "
                        f"na temporada {corrida['temporada']}."
                    )
                elif r["status"] == "nao_completou":
                    extra = "Quebra mecânica."
                    if r["trocaDeCarro"]:
                        extra = "Quebrou depois de trocar de kart."
                    frase = (
                        f"{nome_kart(p)} ({peso}) largou, não completou a prova. {extra} "
                        f"Voltas cumpridas: {r['numeroVoltas']}. Tempo até o abandono: {r['tempoTotal']}. "
                        f"Melhor volta: {r['melhorVolta']}. Pontos na etapa: {r['pontos']} "
                        f"(mínimo de quem corre e não é desclassificado). "
                        f"Acumulado após esta etapa: {pl(acum[p['id']], 'ponto', 'pontos')} na Copa Traçado "
                        f"e {pl(acum_temp[(corrida['temporada'], p['id'])], 'ponto', 'pontos')} "
                        f"na temporada {corrida['temporada']}."
                    )
                else:
                    feitos = []
                    if r["polePosition"]:
                        feitos.append("fez a pole position")
                    if p["id"] == corrida["melhorVoltaPilotoId"]:
                        feitos.append("marcou a melhor volta da prova")
                    prefixo = (" " + " e ".join(feitos) + " e") if feitos else ""
                    adv_txt = (
                        " Recebeu bandeira preta e branca (advertência)."
                        if r["bandeira"] == "preta_e_branca"
                        else ""
                    )
                    troca_txt = " Trocou de kart durante a etapa." if r["trocaDeCarro"] else ""
                    ovt = r["ultrapassagens"]
                    grid_pos = r.get("posicaoGrid")
                    frase = (
                        f"{nome_kart(p)} ({peso}){prefixo} chegou em {r['posicao']}º, "
                        f"com tempo total {r['tempoTotal']}, {pl(r['numeroVoltas'], 'volta', 'voltas')} "
                        f"e melhor volta {r['melhorVolta']}. Largou em {grid_pos}º e fez "
                        f"{pl(ovt, 'ultrapassagem', 'ultrapassagens')}.{adv_txt}{troca_txt} "
                        f"Pontos conquistados na etapa {corrida['id']}: {r['pontos']}. "
                        f"Acumulado após esta etapa: {pl(acum[p['id']], 'ponto', 'pontos')} na Copa Traçado "
                        f"e {pl(acum_temp[(corrida['temporada'], p['id'])], 'ponto', 'pontos')} "
                        f"na temporada {corrida['temporada']}."
                    )
                blocos.append(f"- {frase}")
            blocos.append("")

            ranking = sorted(
                [{"id": pid, "pts": pts} for pid, pts in acum.items()],
                key=lambda x: (-x["pts"], por_id[x["id"]]["nome"]),
            )
            top = ranking[:10]
            lista_top = "; ".join(
                f"{i}º {por_id[x['id']]['nome']} ({x['pts']} pts)"
                for i, x in enumerate(top, start=1)
            )
            bloco_temp = sorted(
                [
                    {"id": pid, "pts": acum_temp[(corrida["temporada"], pid)]}
                    for pid in por_id
                ],
                key=lambda x: (-x["pts"], por_id[x["id"]]["nome"]),
            )[:8]
            lista_temp = "; ".join(
                f"{i}º {por_id[x['id']]['nome']} ({x['pts']} pts)"
                for i, x in enumerate(bloco_temp, start=1)
            )
            blocos.append("### Classificação após a etapa")
            blocos.append("")
            blocos.append(
                f"Top 10 da Copa Traçado (geral, somando 2024, 2025 e 2026) depois da etapa "
                f"{corrida['id']}: {lista_top}."
            )
            blocos.append(
                f"Top 8 da temporada {corrida['temporada']} depois desta etapa: {lista_temp}."
            )
            blocos.append("")
            if corrida.get("ultimaEtapaTemporada") and corrida.get("especialTemporada"):
                blocos.extend(render_especial(corrida["especialTemporada"], por_id))

        lider = max(acum.items(), key=lambda kv: kv[1])
        blocos.append(f"## Fecha {MESES[mes]} de {ano}")
        blocos.append("")
        blocos.append(f"Vitórias do mês: {'; '.join(vencedores_mes)}.")
        blocos.append(
            f"Na soma geral da Copa Traçado, quem abre o próximo mês na frente é "
            f"{nome_kart(por_id[lider[0]])}, com {pl(lider[1], 'ponto', 'pontos')}."
        )
        if ano == 2026 and mes == 9:
            campeao = max(acum.items(), key=lambda kv: kv[1])
            blocos.append(
                f"A etapa 2026-12, no sábado 12 de setembro de 2026, encerra a Copa Traçado. "
                f"Campeão geral das três temporadas: {nome_kart(por_id[campeao[0]])}, com "
                f"{pl(campeao[1], 'ponto', 'pontos')} somados nas 42 etapas (2024-01 a 2026-12)."
            )
        blocos.append(
            "Quem não correu em alguma prova deste mês zerou a etapa correspondente. "
            "Os boletins seguintes da Revista Traçado seguem o mesmo critério: presença, "
            "posição, pontos da etapa, acumulado, cores do kart, peso e lastro de cada piloto."
        )
        blocos.append("")

        path = OUT_ARTIGOS / f"copa-tracado-{ano:04d}-{mes:02d}.md"
        path.write_text("\n".join(blocos), encoding="utf-8")


def main() -> None:
    meta, nomes, rows = ler_csv()
    assert len(nomes) == 30
    assert len(meta) == 42
    datas = calendario()
    pilotos = montar_pilotos(nomes, rows)
    resultados = montar_resultados(rows)
    corridas = montar_corridas(meta, resultados, datas)
    por_temp = anexar_especiais(corridas, pilotos)
    geral = classificacao(corridas, pilotos)
    ids = [c["id"] for c in corridas]
    assert ids[0] == "2024-01"
    assert ids[15] == "2024-16"
    assert ids[16] == "2025-01"
    assert ids[-1] == "2026-12"
    assert sum(1 for c in corridas if c.get("especialTemporada")) == 3

    data = {
        "campeonato": {
            "nome": "Copa Traçado de Kart",
            "categoria": "rental kart / categoria de lastro 100 kg",
            "periodo": {
                "inicio": datas[0].isoformat(),
                "fim": datas[-1].isoformat(),
            },
            "identificacaoEtapas": "Cada temporada reinicia o ID em AAAA-##. 2024-01 a 2024-16; 2025-01 a 2025-14; 2026-01 a 2026-12.",
            "totalPilotos": 30,
            "totalCorridas": 42,
            "regulamento": {
                "pesoReferenciaKg": 100,
                "lastro": "Diferença positiva até 100 kg. Se o piloto pesar 100 kg ou mais, lastro = 0.",
                "diaDeProva": "sábado",
                "intervaloDias": 14,
                "intervaloObservacao": "Quinzena em sábados (14 dias). Quinze dias corridos a partir de um sábado cairiam no domingo.",
                "pontuacao": {
                    "1": 40,
                    "2": 32,
                    "3": 26,
                    "4": 14,
                    "5": 12,
                    "6": 10,
                    "7": 8,
                    "8": 6,
                    "9": 4,
                    "10": 3,
                    "11": 2,
                    "12OuMais": 1,
                    "naoCompletou": 1,
                    "ausente": 0,
                    "desclassificadoBandeiraPreta": 0,
                    "observacao": "Quem não comparece não pontua. Todos os que largam e não são desclassificados pontuam. O pódio (40/32/26) tem vantagem clara sobre o 4º (14).",
                },
                "bandeiras": {
                    "preta": "desclassificação",
                    "pretaEBranca": "advertência",
                },
            },
        },
        "pilotos": pilotos,
        "corridas": corridas,
        "classificacaoGeral": geral,
        "classificacaoPorTemporada": {
            str(ano): ranking for ano, ranking in por_temp.items()
        },
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    gerar_artigos(data)
    print(f"JSON: {OUT_JSON}")
    print(f"Artigos: {OUT_ARTIGOS}")
    print("Campeao:", geral[0])


if __name__ == "__main__":
    main()
