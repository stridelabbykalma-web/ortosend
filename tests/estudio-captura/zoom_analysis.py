# Suavidad del zoom de seguimiento a partir de la traza por frame (out/<escenario>_log.json).
# uso: python3 zoom_analysis.py post_ok ant_32623
import json,sys,os
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"out")
ZOOM_MAX_RATE=0.7; TAU=0.6
for name in sys.argv[1:]:
    L=json.load(open(os.path.join(OUT,f"{name}_log.json")))
    pre=[e for e in L if e["phase"] in ("live","countdown") and e["rect"]]
    rec=[e for e in L if e["phase"]=="recording" and e["rect"]]
    if not rec: print(f"== {name}: sin grabación en la traza"); continue
    src=rec[0]["src"]; full=max(1,src["h"])
    # antes de grabar: ¿se tocó el encuadre?
    pre_zoomed=sum(1 for e in pre if e["rect"]["h"]<full-1)
    # durante: cambios relativos por frame y velocidad relativa por segundo
    rel=[];rate=[];viol=0;cx=[];cy=[]
    for a,b in zip(rec,rec[1:]):
        dt=(b["t"]-a["t"])/1000
        if dt<=0: continue
        r=abs(b["rect"]["h"]-a["rect"]["h"])/max(1,a["rect"]["h"])
        rel.append(r); rate.append(r/dt)
        if r>ZOOM_MAX_RATE*min(dt,0.1)*1.02+1e-6: viol+=1
        cx.append(abs((b["rect"]["x"]+b["rect"]["w"]/2)-(a["rect"]["x"]+a["rect"]["w"]/2))/src["w"])
    hs=[e["rect"]["h"] for e in rec]
    zf=[full/h for h in hs]
    t0=rec[0]["t"]
    traj=[(round((e["t"]-t0)/1000,1),round(full/e["rect"]["h"],2)) for e in rec[::max(1,len(rec)//12)]]
    q=lambda v,p: sorted(v)[min(len(v)-1,int(len(v)*p))] if v else float('nan')
    print(f"== {name}: src {src['w']}x{src['h']} | frames live/countdown {len(pre)} (con zoom: {pre_zoomed}) | frames grabando {len(rec)} ({(rec[-1]['t']-t0)/1000:.1f} s)")
    print(f"   zoom durante la grabación: inicio {zf[0]:.2f}x → máx {max(zf):.2f}x → final {zf[-1]:.2f}x")
    print(f"   cambio relativo por frame: med {q(rel,.5)*100:.2f}% p95 {q(rel,.95)*100:.2f}% máx {max(rel)*100:.2f}% | velocidad: med {q(rate,.5)*100:.0f}%/s p95 {q(rate,.95)*100:.0f}%/s máx {max(rate)*100:.0f}%/s (tope {ZOOM_MAX_RATE*100:.0f}%/s) | frames fuera de tope: {viol}")
    print(f"   desplazamiento del centro por frame: med {q(cx,.5)*100:.2f}% del ancho, máx {max(cx)*100:.2f}%")
    print(f"   trayectoria (s, zoom): {traj}")
