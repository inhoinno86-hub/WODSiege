import { useState } from "react";
import { Geolocation } from "@capacitor/geolocation";
import {
  CheckCircle2,
  MapPin,
  Plus,
  Search,
  Shield,
  Users,
} from "lucide-react";
import { usePilot } from "../context";
import { BoxMark, Empty, Field, Form, Modal } from "../components";
import type { Box } from "../types";

function CreateBox({ close }: { close: () => void }) {
  const { state, mutate, toast } = usePilot();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const duplicates = state.boxes.filter(
    (b) =>
      (name.trim().length > 1 &&
        b.name.toLowerCase().includes(name.trim().toLowerCase())) ||
      (address.trim().length > 3 && b.address.includes(address.trim())) ||
      (lat !== "" &&
        lng !== "" &&
        Math.hypot(
          (b.lat - Number(lat)) * 111320,
          (b.lng - Number(lng)) *
            111320 *
            Math.cos((Number(lat) * Math.PI) / 180),
        ) <= 200),
  );
  return (
    <Modal title="우리 Box 등록" close={close}>
      <p className="muted">
        최소 3명의 위치 확인과 별도의 운영 권한 확인을 거쳐 경기에 참가할 수
        있어요.
      </p>
      <Form
        label="Box 등록 신청"
        onSubmit={async (data) => {
          await mutate("/boxes", {
            ...Object.fromEntries(data),
            lat: Number(data.get("lat")),
            lng: Number(data.get("lng")),
          });
          close();
          toast("Box를 등록했습니다. 구성원 가입과 위치 확인을 진행해 주세요.");
        }}
      >
        <Field label="Box 이름">
          <input
            name="name"
            required
            minLength={2}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 성수 트레이닝 Box"
          />
        </Field>
        <Field label="도로명 주소">
          <input
            name="address"
            required
            maxLength={180}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="서울특별시 성동구 …"
          />
        </Field>
        {duplicates.length > 0 && (
          <div className="info-note">
            비슷한 Box가 있어요:{" "}
            {duplicates.map((b) => `${b.name} (${b.address})`).join(", ")}. 같은
            Box라면 새 등록보다 가입 신청을 이용하세요.
          </div>
        )}
        <div className="form-row">
          <Field label="시·군·구">
            <input
              name="district"
              required
              maxLength={30}
              placeholder="성동구"
            />
          </Field>
          <Field label="동">
            <input name="dong" required maxLength={30} placeholder="성수동" />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Box 위도">
            <input
              name="lat"
              type="number"
              required
              step="any"
              min="-90"
              max="90"
              placeholder="37.5445"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </Field>
          <Field label="Box 경도">
            <input
              name="lng"
              type="number"
              required
              step="any"
              min="-180"
              max="180"
              placeholder="127.0557"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
            />
          </Field>
        </div>
        <p className="fine-print">
          지도에서 확인한 Box 중심 좌표를 입력하세요. 실제 위치 확인은 각
          구성원의 휴대폰에서 별도로 진행합니다.
        </p>
        <Field label="Box 소개">
          <textarea
            name="description"
            required
            maxLength={600}
            rows={3}
            placeholder="우리 Box의 분위기와 장비를 소개해 주세요."
          />
        </Field>
      </Form>
    </Modal>
  );
}

function BoxDetail({ box }: { box: Box }) {
  const { state, mutate, run, toast } = usePilot();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const mine = box.id === state.user.boxId;
  const owner = box.ownerId === state.user.id;
  const checked = box.checks.some((c) => c.userId === state.user.id);
  async function checkIn() {
    setChecking(true);
    setError("");
    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });
      await mutate(`/boxes/${box.id}/check-in`, {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
        consent: true,
      });
      toast("위치 확인을 완료했습니다.");
    } catch (e) {
      const message = (e as Error).message;
      setError(
        /denied|permission|권한/i.test(message)
          ? "위치 권한이 꺼져 있습니다. 기기 설정에서 WODSiege의 위치 권한을 허용한 뒤 다시 시도하세요. 실내 수신 오류는 운영자에게 검토를 요청해 주세요."
          : `위치 확인을 완료하지 못했습니다. ${message} 건물 입구에서 다시 시도하거나 운영자 검토를 요청해 주세요.`,
      );
    } finally {
      setChecking(false);
    }
  }
  return (
    <section className="panel box-detail">
      <div className="box-detail-header">
        <BoxMark box={box} />
        <div>
          <span className="eyebrow">{mine ? "OUR BOX" : "MEET THE BOX"}</span>
          <h2>{box.name}</h2>
          <p className="muted">
            <MapPin size={15} /> {box.district} · {box.dong}
          </p>
        </div>
      </div>
      <p>{box.description}</p>
      <p className="muted">{box.address}</p>
      <div className="verification-grid">
        <div>
          <Users size={20} />
          <strong>{box.members.length}명</strong>
          <span>소속 멤버</span>
        </div>
        <div>
          <MapPin size={20} />
          <strong>{box.checks.length}/3</strong>
          <span>위치 확인</span>
        </div>
        <div>
          <Shield size={20} />
          <strong>{box.operatorVerified ? "확인 완료" : "검토 대기"}</strong>
          <span>운영 권한</span>
        </div>
      </div>
      <div className={`info-note ${box.active ? "verified-note" : ""}`}>
        {box.active
          ? "구성원·위치·운영 확인을 마친 Box입니다."
          : "구성원 위치 확인과 운영 권한 확인은 별도입니다. 두 요건을 충족해야 대결을 열 수 있어요."}
      </div>
      <h3>함께하는 멤버</h3>
      <div className="member-list">
        {box.members.map((id) => (
          <div key={id}>
            <span className="avatar">
              {state.users.find((u) => u.id === id)?.name.slice(0, 1) || "?"}
            </span>
            <strong>{state.users.find((u) => u.id === id)?.name || id}</strong>
            {id === box.ownerId && <span className="tag">관리자</span>}
            {box.checks.some((c) => c.userId === id) && (
              <CheckCircle2
                size={17}
                className="lime"
                aria-label="위치 확인 완료"
              />
            )}
          </div>
        ))}
      </div>
      {mine && !checked && (
        <div className="checkin-panel">
          <h3>Box에서 내 위치 확인</h3>
          <p className="muted">
            Box에서 150m 이내, 정확도 100m 이내의 위치가 필요합니다. 요청할 때만
            위치를 확인해요.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            이 Box 소속에 동의하며, 등록 확인을 위해 현재 위치를 사용하는 데
            동의합니다.
          </label>
          <button
            className="primary"
            disabled={!consent || checking}
            onClick={() => void checkIn()}
          >
            <MapPin size={18} />
            {checking ? "현재 위치 확인 중…" : "현재 위치로 참여 확인"}
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
      )}
      {mine && checked && (
        <p className="success-text">
          <CheckCircle2 size={18} /> 내 위치 확인이 완료되었습니다.
        </p>
      )}
      {!mine && state.user.role !== "operator" && (
        <button
          className="primary"
          disabled={state.joinRequests.some(
            (r) =>
              r.userId === state.user.id &&
              r.boxId === box.id &&
              r.status === "pending",
          )}
          onClick={() =>
            void run(
              `/boxes/${box.id}/join`,
              {},
              "가입을 신청했습니다. Box 관리자의 승인을 기다려 주세요.",
            )
          }
        >
          <Plus size={18} />
          {state.joinRequests.some(
            (r) =>
              r.userId === state.user.id &&
              r.boxId === box.id &&
              r.status === "pending",
          )
            ? "가입 승인 대기 중"
            : state.user.boxId
              ? "이 Box로 소속 이전 신청"
              : "이 Box에 가입 신청"}
        </button>
      )}
      {owner && (
        <div className="join-requests">
          <h3>가입 요청</h3>
          {state.joinRequests.filter(
            (r) => r.boxId === box.id && r.status === "pending",
          ).length ? (
            state.joinRequests
              .filter((r) => r.boxId === box.id && r.status === "pending")
              .map((r) => (
                <div key={r.id}>
                  <strong>
                    {state.users.find((u) => u.id === r.userId)?.name ||
                      r.userId}
                  </strong>
                  <button
                    className="secondary"
                    onClick={() =>
                      void run(
                        `/boxes/${box.id}/approve-member`,
                        { userId: r.userId },
                        "구성원 가입을 승인했습니다.",
                      )
                    }
                  >
                    소속 승인
                  </button>
                </div>
              ))
          ) : (
            <p className="muted">대기 중인 가입 요청이 없습니다.</p>
          )}
        </div>
      )}
    </section>
  );
}

export function Boxes() {
  const { state } = usePilot();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(state.user.boxId || "");
  const [create, setCreate] = useState(false);
  const boxes = state.boxes.filter((b) =>
    `${b.name} ${b.address}`.toLowerCase().includes(query.toLowerCase()),
  );
  const box = state.boxes.find((b) => b.id === selected);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">FIND YOUR CREW</span>
          <h1>함께할 Box를 찾아요.</h1>
          <p>같은 공간에서 운동하고, 같은 이름으로 도전하세요.</p>
        </div>
        {!state.user.boxId && state.user.role !== "operator" && (
          <button className="primary" onClick={() => setCreate(true)}>
            <Plus size={18} /> Box 등록
          </button>
        )}
      </div>
      <label className="search-field">
        <Search size={19} />
        <input
          aria-label="Box 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Box 이름이나 주소로 검색"
        />
      </label>
      <div className="boxes-layout">
        <div className="box-list">
          {boxes.length ? (
            boxes.map((b) => (
              <button
                key={b.id}
                className={`box-list-item ${selected === b.id ? "selected" : ""}`}
                onClick={() => setSelected(b.id)}
              >
                <BoxMark box={b} small />
                <span>
                  <strong>{b.name}</strong>
                  <small>
                    {b.district} · {b.dong}
                  </small>
                </span>
                <span
                  className={`status ${b.active ? "finalized" : "applied"}`}
                >
                  {b.active ? "참가 가능" : "확인 중"}
                </span>
              </button>
            ))
          ) : (
            <Empty title="아직 등록된 Box가 없어요">
              <p>이름과 주소로 다시 검색하거나 우리 Box를 등록하세요.</p>
            </Empty>
          )}
        </div>
        {box ? (
          <BoxDetail key={box.id} box={box} />
        ) : (
          <Empty title="Box를 선택해 주세요">
            <p>구성원, 확인 상태와 가입 방법을 살펴볼 수 있어요.</p>
          </Empty>
        )}
      </div>
      {create && (
        <CreateBox
          close={() => {
            setCreate(false);
          }}
        />
      )}
    </>
  );
}
