import { Users, ShieldCheck, HandCoins, Pencil } from "lucide-react";
import { Feedback } from "../../components/Feedback";
import { LoadingState } from "../../components/LoadingState";
import { SearchableSelect } from "../../components/SearchableSelect";
import { date } from "../../lib/format";
import type { Member, Family } from "../../types/members";

type Props = {
  members: Member[];
  loading: boolean;
  error: string;
  isSuperAdmin: boolean;
  canManageMembers: boolean;
  families: Family[];
  familiesLoading: boolean;
  familiesError: string;
  memberFamilyId: string;
  onFamilyChange: (id: string) => void;
  onRetry: () => void;
  onEdit: (member: Member) => void;
};
export function MemberList({
  members,
  loading,
  error,
  isSuperAdmin,
  canManageMembers,
  families,
  familiesLoading,
  familiesError,
  memberFamilyId,
  onFamilyChange,
  onRetry,
  onEdit,
}: Props) {
  return (
    <>
      {isSuperAdmin && (
        <section className="panel family-context">
          <SearchableSelect
            label="Keluarga yang ditampilkan"
            value={memberFamilyId}
            placeholder="Semua keluarga"
            disabled={familiesLoading}
            options={families.map((family) => ({
              value: family.id,
              label: `${family.name} · ${family.code}`,
            }))}
            onChange={onFamilyChange}
          />
          {familiesLoading && (
            <LoadingState label="Memuat daftar keluarga..." />
          )}
          {familiesError && <Feedback tone="error">{familiesError}</Feedback>}
        </section>
      )}
      <section className="member-stats">
        <article>
          <span className="stat-icon coral-light">
            <Users size={17} />
          </span>
          <div>
            <strong>{loading ? "…" : members.length}</strong>
            <small>Total anggota</small>
          </div>
        </article>
        <article>
          <span className="stat-icon green-light">
            <ShieldCheck size={17} />
          </span>
          <div>
            <strong>
              {loading
                ? "…"
                : members.filter((member) => member.status === "ACTIVE").length}
            </strong>
            <small>Akses aktif</small>
          </div>
        </article>
        <article>
          <span className="stat-icon neutral-light">
            <HandCoins size={17} />
          </span>
          <div>
            <strong>
              {loading
                ? "…"
                : members.filter((member) => member.role === "TREASURER")
                    .length}
            </strong>
            <small>Pengelola dana</small>
          </div>
        </article>
      </section>
      <section className="panel member-list">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">RUANG KELUARGA</p>
            <h2>Daftar anggota</h2>
            <p className="panel-description">
              Periksa identitas dan akses setiap orang di ruang ini.
            </p>
          </div>
        </div>
        {loading ? (
          <LoadingState label="Memuat data anggota..." />
        ) : error ? (
          <Feedback tone="error">
            <p>{error}</p>
            <button className="secondary-button" onClick={onRetry}>
              Coba lagi
            </button>
          </Feedback>
        ) : members.length === 0 ? (
          <p className="empty">
            {isSuperAdmin && !memberFamilyId
              ? "Belum ada anggota terdaftar di seluruh keluarga."
              : "Belum ada anggota di ruang keluarga ini. Admin dapat menambahkan anggota melalui tombol Tambah anggota."}
          </p>
        ) : (
          <div className="member-table">
            <div className="member-table-head">
              <span>ANGGOTA</span>
              <span>PERAN</span>
              <span>STATUS</span>
              <span>TERDAFTAR</span>
            </div>
            {members.map((member) => (
              <div className="member-row" key={member.id}>
                <div className="member-identity">
                  <span className="avatar coral">
                    {member.user.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{member.user.name}</strong>
                    <small>{member.user.email || member.user.phone}</small>
                    {isSuperAdmin && member.family && (
                      <small>
                        {member.family.name} · {member.family.code}
                      </small>
                    )}
                  </div>
                </div>
                <span className="role-label">
                  {member.role === "ADMIN"
                    ? "Admin keluarga"
                    : member.role === "TREASURER"
                      ? "Pengelola dana"
                      : "Anggota"}
                </span>
                <span className={`status ${member.status.toLowerCase()}`}>
                  {member.status === "ACTIVE" ? "Aktif" : "Tidak aktif"}
                </span>
                <div className="member-row-actions">
                  <small className="joined-date">
                    {date.format(new Date(member.joinedAt))}
                  </small>
                  {canManageMembers &&
                    member.user.systemRole !== "SUPER_ADMIN" && (
                      <button
                        type="button"
                        className="secondary-button member-edit-button"
                        aria-label={`Edit peran ${member.user.name}`}
                        onClick={() => onEdit(member)}
                      >
                        <Pencil size={14} aria-hidden="true" /> Edit peran
                      </button>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
