import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { logoutAction } from "@/app/(auth)/actions";

export async function Nav() {
  const user = await getSessionUser();
  return (
    <div className="nav">
      <div className="wrap">
        <Link href="/" className="logo">
          orto<b>send</b>
        </Link>
        <div className="links">
          {!user && (
            <>
              <Link href="/como-funciona">Cómo funciona</Link>
              <Link href="/buscar">Buscar clínica</Link>
              <Link href="/para-clinicas">Para clínicas</Link>
            </>
          )}
          {user && (
            <Link href="/panel" className="btn pri">
              Mi panel
            </Link>
          )}
          {user ? (
            <>
              <span className="tiny">{user.name.split("(")[0]}</span>
              <form action={logoutAction}>
                <button type="submit">Salir</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="btn">
              Acceder
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
