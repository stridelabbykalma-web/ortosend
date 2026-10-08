// Las 5 casillas de consentimiento del registro web (4 obligatorias + marketing opcional).
import { CAMPO_CONSENT } from "@/lib/consent/web";
import { ETIQUETA, ORDEN, SLUG, esObligatorio } from "@/lib/consent/tipos";

export function CasillasConsentimiento({ menor, exigir = true }: { menor?: boolean; exigir?: boolean }) {
  return (
    <div>
      {menor && (
        <div className="tiny">Si el paciente es menor de 16 años, declaro ser su padre, madre o tutor legal y acepto en su nombre.</div>
      )}
      {ORDEN.map((t) => (
        <label className="chk" key={t}>
          <input type="checkbox" name={CAMPO_CONSENT[t]} required={exigir && esObligatorio(t)} /> He leído y acepto:{" "}
          <a href={`/legal/documento/${SLUG[t]}`} target="_blank" rel="noreferrer">
            {ETIQUETA[t]}
          </a>
        </label>
      ))}
    </div>
  );
}
