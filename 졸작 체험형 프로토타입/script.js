/*****************************************
 * 1) TM 모델 경로
 *****************************************/
const MODEL_URL = "model/model.json";
const METADATA_URL = "model/metadata.json";

/*****************************************
 * 2) 클래스 매핑
 *****************************************/
const CLASS_CONFIG = {
  COOK: {
    title: "집밥 셰프 되기",
    desc: "시즈닝과 불 조절만 익혀도 요리 레벨업. 한식 → 파스타 → 디저트 순으로 확장!",
    missions: [
      { text: "주 1회 신메뉴 도전", icon: "icons/cook_1.png" },
      { text: "레시피 카드 5개 제작", icon: "icons/cook_2.png" }
    ],
    media: "media/cook.mp4"
  },
  READING: {
    title: "올해 12권 읽기",
    desc: "한 달 한 권. 하이라이트 정리와 감상 메모로 기억을 내 것으로!",
    missions: [
      { text: "월 1권 완독 인증", icon: "icons/reading_1.png" },
      { text: "인상비평 10편 작성", icon: "icons/reading_2.png" }
    ],
    media: "media/reading.mp4"
  },
  TRAVEL: {
    title: "로컬 여행 마스터",
    desc: "골목·시장·박물관·산책루트까지 로컬 기록하기.",
    missions: [
      { text: "로컬 맛집 지도 만들기", icon: "icons/travel_1.png" },
      { text: "여행 브이로그 3분", icon: "icons/travel_2.png" }
    ],
    media: "media/travel.mp4"
  },
  MUSIC: {
    title: "나만의 플레이리스트",
    desc: "주 2곡 선정 후 3줄 감상평. 장르 하나 깊게 파보기.",
    missions: [
      { text: "월간 플레이리스트 10곡", icon: "icons/music_1.png" },
      { text: "라이브 공연 1회", icon: "icons/music_2.png" }
    ],
    media: "media/music.mp4"
  },
  SPORTS: {
    title: "체력 한계 갱신",
    desc: "유산소+근력 30분 콤보. 꾸준함이 핵심!",
    missions: [
      { text: "주 3회 30분 운동", icon: "icons/sports_1.png" },
      { text: "퍼스널 베스트 갱신", icon: "icons/sports_2.png" }
    ],
    media: "media/sports.mp4"
  },
  none: {
    title: "버킷리스트명",
    desc: "카드를 카메라에 비추면, 해당 카드에 연결된 설명이 여기에 표시됩니다.",
    missions: [
      { text: "나만의 버킷리스트 만들기!", icon: "icons/default_1.png" },
      { text: "모티와 함께 꿈을 이루어보세요!", icon: "icons/default_2.png" }
    ],
    media: "media/sports.mp4"
  }
};

/*****************************************
 * 3) 인식 파라미터
 *****************************************/
const STABLE_THRESHOLD = 0.8;
const REQUIRED_CONSEC_FRAMES = 60;
const coolDownMs = 1200;

/*****************************************
 * 4) 상태 변수
 *****************************************/
let model = null, modelReady = false;
let webcamStream = null, rafId = null;
let counters = {}, activeClass = null, lastActivateTs = 0, isLocked = false;

/*****************************************
 * 5) DOM 참조
 *****************************************/
const camBox = document.getElementById("camBox");
const webcamEl = document.getElementById("webcam");
const overlay  = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const lockedMedia = document.getElementById("lockedMedia");
const btnStart = document.getElementById("btnStart");

const blTitle = document.getElementById("blTitle");
const blDesc  = document.getElementById("blDesc");
const missionList = document.getElementById("missionList");

/* 방명록 */
const fbForm  = document.getElementById("fbForm");
const fbName  = document.getElementById("fbName");
const fbOrg   = document.getElementById("fbOrg");
const fbMsg   = document.getElementById("fbMsg");
const fbListEl= document.getElementById("fbList");
const btnSave = document.getElementById("btnSave");

/* localStorage 키 */
const LS_KEY_MAP = "moti_feedbacks_by_class_v1";
let feedbackMap = {}, currentBucket = "none";

/*****************************************
 * 6) 아바타 랜덤
 *****************************************/
const AVATAR_DIR = "avatars"; // 폴더명
const AVATAR_MAX = 5;

function randomAvatar() {
  const n = Math.floor(Math.random() * AVATAR_MAX) + 1;
  return `${AVATAR_DIR}/person_${n}.png`;
}

/*****************************************
 * 7) 초기화
 *****************************************/
(function init(){
  applyClass("none");
  feedbackMap = loadMap();
  renderFeedbacks();
  loadModelInBackground();
})();

/*****************************************
 * 8) 모델 로드
 *****************************************/
async function loadModelInBackground(){
  try {
    model = await tmImage.load(MODEL_URL, METADATA_URL);
    const meta = await (await fetch(METADATA_URL)).json();
    meta.labels.forEach(c => counters[c] = 0);
    modelReady = true;
  } catch(e){ console.error("모델 로드 실패:", e); }
}

/*****************************************
 * 9) 카메라
 *****************************************/
btnStart.addEventListener("click", async ()=>{
  unlockAndReset();
  await startCamera();
});

async function startCamera(){
  stopCamera();
  try{
    const stream = await navigator.mediaDevices.getUserMedia({
      audio:false, video:{ facingMode:"user", width:{ideal:640}, height:{ideal:480} }
    });
    webcamStream = stream;
    webcamEl.srcObject = stream;
    await webcamEl.play();
    loop();
  }catch(err){ console.error("카메라 접근 실패:", err); }
}

function stopCamera(){
  if (rafId) cancelAnimationFrame(rafId);
  if (webcamStream){ webcamStream.getTracks().forEach(t=>t.stop()); webcamStream=null; }
}

function unlockAndReset(){
  isLocked=false;
  activeClass=null;
  lockedMedia.classList.remove("show");
  lockedMedia.innerHTML="";
  applyClass("none");
}

/*****************************************
 * 10) 추론 루프
 *****************************************/
async function loop(){
  rafId=requestAnimationFrame(loop);
  if(!modelReady || !webcamStream || webcamEl.readyState<2) return;

  const prediction=await model.predict(webcamEl,false);
  const best=prediction.reduce((a,b)=>(a.probability>b.probability?a:b));

  for(const p of prediction){
    const name=p.className, prob=p.probability;
    counters[name]=prob>=STABLE_THRESHOLD
      ? Math.min(REQUIRED_CONSEC_FRAMES,(counters[name]||0)+1)
      : Math.max(0,(counters[name]||0)-1);
  }

  const now=performance.now();
  if(!isLocked &&
     best.probability>=STABLE_THRESHOLD &&
     counters[best.className]>=REQUIRED_CONSEC_FRAMES &&
     (now-lastActivateTs)>coolDownMs &&
     activeClass!==best.className){

    activeClass=best.className;
    lastActivateTs=now;
    applyClass(activeClass);
    setCurrentBucket(activeClass);
    if(activeClass!=="none"){
      showLockedMedia(CLASS_CONFIG[activeClass]?.media);
      isLocked=true;
      stopCamera();
    }
  }
}

/*****************************************
 * 11) UI 업데이트
 *****************************************/
function applyClass(name) {
  const cfg = CLASS_CONFIG[name];
  if (!cfg) return;

  blTitle.textContent = cfg.title;
  blDesc.textContent = cfg.desc;
  missionList.innerHTML = "";

  cfg.missions.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "row";
    const icon = document.createElement("img");
    icon.src = m.icon;
    icon.alt = m.text;
    const text = document.createElement("div");
    text.textContent = m.text;
    row.append(icon, text);
    missionList.append(row);

    if (i < cfg.missions.length - 1) {
      const hr = document.createElement("div");
      hr.className = "divider";
      missionList.append(hr);
    }
  });
}

function showLockedMedia(src){
  lockedMedia.classList.add("show");
  lockedMedia.innerHTML="";
  const v=document.createElement("video");
  v.src=src; v.playsInline=true; v.autoplay=true; v.loop=true; v.muted=true; v.controls=true;
  lockedMedia.appendChild(v);
  v.play().catch(()=>{v.muted=true;v.controls=true;});
}

/*****************************************
 * 12) 방명록 저장소
 *****************************************/
function loadMap(){
  try{const raw=localStorage.getItem(LS_KEY_MAP);return raw?JSON.parse(raw):{};}catch{return {};}
}
function saveMap(map){localStorage.setItem(LS_KEY_MAP,JSON.stringify(map));}
function getList(cls){return feedbackMap[cls]||[];}
function setList(cls,rows){feedbackMap[cls]=rows;saveMap(feedbackMap);}
function addFeedbackTo(cls,row){const list=getList(cls);list.unshift(row);setList(cls,list);}
function deleteFeedbackById(cls, id){
  const idStr = String(id);
  const next = getList(cls).filter(row => String(row.id) !== idStr);
  setList(cls, next);
}

/*****************************************
 * 13) 렌더링
 *****************************************/
function setCurrentBucket(cls){ currentBucket=cls||"none"; renderFeedbacks(); }

function renderFeedbacks() {
  const rows = getList(currentBucket);
  fbListEl.innerHTML = "";

  rows.forEach((f, i) => {
    const wrap = document.createElement("div");
    wrap.className = "fbItem";
    wrap.dataset.id = String(f.id);

    const delBtn = document.createElement("button");
    delBtn.className = "del";
    delBtn.type = "button";
    delBtn.textContent = "×";

    if (!f.avatar) {
      f.avatar = randomAvatar();
      const cloned = rows.slice();
      cloned[i] = f;
      setList(currentBucket, cloned);
    }

    const avatar = document.createElement("div");
    avatar.className = "fbAvatar";
    avatar.style.backgroundImage = `url(${f.avatar})`;

    const text = document.createElement("div");
    text.className = "fbText";
    const rowTop = document.createElement("div");
    rowTop.className = "fbRow";
    const nameEl = document.createElement("div");
    nameEl.className = "fbName";
    nameEl.textContent = f.name || "";
    const orgEl = document.createElement("div");
    orgEl.className = "fbOrg";
    orgEl.textContent = f.org || "";
    const msgEl = document.createElement("div");
    msgEl.className = "fbMsg";
    msgEl.textContent = f.msg || "";

    rowTop.append(nameEl, orgEl);
    text.append(rowTop, msgEl);
    wrap.append(delBtn, avatar, text);
    fbListEl.append(wrap);

    if (i < rows.length - 1) {
      const hr = document.createElement("div");
      hr.className = "fbDivider";
      fbListEl.append(hr);
    }
  });
}

/*****************************************
 * 14) 삭제 이벤트 (이벤트 위임)
 *****************************************/
fbListEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".del");
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  const item = btn.closest(".fbItem");
  if (!item) return;

  const id = item.dataset.id;
  deleteFeedbackById(currentBucket, id);
  renderFeedbacks();
});

/*****************************************
 * 15) 저장 이벤트
 *****************************************/
btnSave.addEventListener("click", (e) => {
  e.preventDefault();
  const ae=document.activeElement;
  if(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA')) ae.blur();
  if (typeof fbForm.requestSubmit === "function") fbForm.requestSubmit();
  else fbForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
});

fbForm.addEventListener("submit", e => {
  e.preventDefault();

  const row = {
    id: String(Date.now()),
    name: (fbName.value || "익명").trim(),
    org:  (fbOrg.value  || "").trim(),
    msg:  (fbMsg.value  || "").trim(),
    ts: Date.now(),
    cls: currentBucket,
    avatar: randomAvatar()
  };

  if (!row.msg) { fbMsg.focus(); return; }

  addFeedbackTo(currentBucket, row);
  fbMsg.value = "";
  renderFeedbacks();
});