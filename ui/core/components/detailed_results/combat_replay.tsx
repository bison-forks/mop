import { ref } from 'tsx-vanilla';

import { OtherAction } from '../../proto/common';
import { ResourceType } from '../../proto/spell';
import { CastBeganLog, DamageDealtLog, Entity, ResourceChangedLog, SimLog } from '../../proto_utils/logs_parser';
import { resourceColors, resourceNames } from '../../proto_utils/names';
import { SimResult } from '../../proto_utils/sim_result';
import i18n from '../../../i18n/config';
import { ResultComponent, ResultComponentConfig, SimResultData } from './result_component';

interface ReplayAction {
	time: number;
	name: string;
	iconUrl: string;
	dmg: number | null;
	isCrit: boolean;
	target: Entity | null;
}

interface ResourceSnapshot {
	time: number;
	type: ResourceType;
	value: number;
	maxValue: number;
}

interface HitEffect {
	time: number;
	targetIndex: number;
	x: number;
	y: number;
	dmg: number | null;
	isCrit: boolean;
}

const BOSS_IMAGE_URL = '/mop/assets/img/boss_patchwerk.png';

const RESOURCE_MAX_DEFAULTS: Partial<Record<ResourceType, number>> = {
	[ResourceType.ResourceTypeMana]: 100,
	[ResourceType.ResourceTypeEnergy]: 100,
	[ResourceType.ResourceTypeRage]: 100,
	[ResourceType.ResourceTypeComboPoints]: 5,
	[ResourceType.ResourceTypeFocus]: 100,
	[ResourceType.ResourceTypeRunicPower]: 100,
	[ResourceType.ResourceTypeChi]: 5,
	[ResourceType.ResourceTypeBloodRune]: 1,
	[ResourceType.ResourceTypeFrostRune]: 1,
	[ResourceType.ResourceTypeUnholyRune]: 1,
	[ResourceType.ResourceTypeDeathRune]: 1,
};

const DOT_RESOURCE_TYPES = new Set([
	ResourceType.ResourceTypeComboPoints,
	ResourceType.ResourceTypeChi,
	ResourceType.ResourceTypeBloodRune,
	ResourceType.ResourceTypeFrostRune,
	ResourceType.ResourceTypeUnholyRune,
	ResourceType.ResourceTypeDeathRune,
]);

const HIT_WINDOW_SEC = 0.45;
const DMG_WINDOW_SEC = 1.1;
const MAX_TICKER = 10;
const MAX_ENEMIES = 8;

export class CombatReplay extends ResultComponent {
	private actions: ReplayAction[] = [];
	private resources: ResourceSnapshot[] = [];
	private hitEffects: HitEffect[] = [];
	private enemyNames: string[] = [];
	private numEnemies = 1;
	private fightLen = 0;

	private currentTime = 0;
	private isPlaying = false;
	private playRate = 1;
	private rafId: number | null = null;
	private lastRaf: number | null = null;

	private readonly preloadedUrls = new Set<string>();

	private ui!: {
		emptyEl: HTMLElement;
		scene: HTMLElement;
		tickerTrack: HTMLElement;
		enemyZone: HTMLElement;
		castBarFill: HTMLElement;
		castBarLabel: HTMLElement;
		castBarTime: HTMLElement;
		resourceBarsEl: HTMLElement;
		actionGridEl: HTMLElement;
		scrubber: HTMLInputElement;
		timeDisplay: HTMLElement;
		playBtn: HTMLButtonElement;
		speedBtns: HTMLButtonElement[];
	};

	constructor(config: ResultComponentConfig) {
		config.rootCssClass = 'combat-replay-root';
		super(config);
		this.buildUI();
	}

	private buildUI(): void {
		const emptyRef = ref<HTMLDivElement>();
		const sceneRef = ref<HTMLDivElement>();
		const tickerTrackRef = ref<HTMLDivElement>();
		const enemyZoneRef = ref<HTMLDivElement>();
		const castBarFillRef = ref<HTMLDivElement>();
		const castBarLabelRef = ref<HTMLDivElement>();
		const castBarTimeRef = ref<HTMLDivElement>();
		const resourceBarsRef = ref<HTMLDivElement>();
		const actionGridRef = ref<HTMLDivElement>();
		const scrubberRef = ref<HTMLInputElement>();
		const timeDisplayRef = ref<HTMLSpanElement>();
		const playBtnRef = ref<HTMLButtonElement>();

		this.rootElem.appendChild(
			<>
				<div ref={emptyRef} className="cr-empty">
					<div className="cr-empty-icon">⚔</div>
					<div className="cr-empty-title">{i18n.t('combat_replay.empty_title')}</div>
					<div className="cr-empty-desc">{i18n.t('combat_replay.empty_desc')}</div>
				</div>
				<div ref={sceneRef} className="cr-scene" style="display:none">
					<div className="cr-arena">
						<div className="cr-vignette" />
						<div className="cr-ticker-outer">
							<div ref={tickerTrackRef} className="cr-ticker-track" />
						</div>
						<div ref={enemyZoneRef} className="cr-enemy-zone" />
					</div>
					<div className="cr-cdm">
						<div className="cr-cdm-player-label" />
						<div className="cr-cast-bar-container">
							<div ref={castBarFillRef} className="cr-cast-bar-fill" />
							<div ref={castBarLabelRef} className="cr-cast-bar-label" />
							<div ref={castBarTimeRef} className="cr-cast-bar-time" />
						</div>
						<div ref={resourceBarsRef} className="cr-resource-bars" />
						<div ref={actionGridRef} className="cr-action-grid" />
					</div>
					<div className="cr-controls">
						<div className="cr-ctrl-row">
							<button className="cr-ctrl-btn" dataset={{ seek: '-5' }} title={i18n.t('combat_replay.seek_back_5')}>⏪</button>
							<button className="cr-ctrl-btn" dataset={{ seek: '-1' }} title={i18n.t('combat_replay.seek_back_1')}>◀</button>
							<button ref={playBtnRef} className="cr-play-btn cr-ctrl-btn">▶</button>
							<button className="cr-ctrl-btn" dataset={{ seek: '1' }} title={i18n.t('combat_replay.seek_fwd_1')}>▶</button>
							<button className="cr-ctrl-btn" dataset={{ seek: '5' }} title={i18n.t('combat_replay.seek_fwd_5')}>⏩</button>
							<div className="cr-speed-btns">
								<button className="cr-speed-btn active" dataset={{ rate: '1' }}>1x</button>
								<button className="cr-speed-btn" dataset={{ rate: '2' }}>2x</button>
								<button className="cr-speed-btn" dataset={{ rate: '3' }}>3x</button>
							</div>
							<span ref={timeDisplayRef} className="cr-time-display">0:00.0 / 0:00.0</span>
						</div>
						<div className="cr-scrub-row">
							<input ref={scrubberRef} type="range" className="cr-scrubber" min="0" max="1000" value="0" step="1" />
						</div>
					</div>
				</div>
			</>,
		);

		this.ui = {
			emptyEl: emptyRef.value!,
			scene: sceneRef.value!,
			tickerTrack: tickerTrackRef.value!,
			enemyZone: enemyZoneRef.value!,
			castBarFill: castBarFillRef.value!,
			castBarLabel: castBarLabelRef.value!,
			castBarTime: castBarTimeRef.value!,
			resourceBarsEl: resourceBarsRef.value!,
			actionGridEl: actionGridRef.value!,
			scrubber: scrubberRef.value!,
			timeDisplay: timeDisplayRef.value!,
			playBtn: playBtnRef.value!,
			speedBtns: Array.from(this.rootElem.querySelectorAll<HTMLButtonElement>('.cr-speed-btn')),
		};

		this.bindEvents();
	}

	private bindEvents(): void {
		this.ui.playBtn.addEventListener('click', () => {
			if (this.isPlaying) this.pause();
			else this.play();
		});

		this.ui.scrubber.addEventListener('mousedown', () => this.pause());
		this.ui.scrubber.addEventListener('input', () => {
			const t = (parseInt(this.ui.scrubber.value) / 1000) * this.fightLen;
			this.seekTo(t);
		});

		this.rootElem.querySelectorAll<HTMLButtonElement>('.cr-ctrl-btn[data-seek]').forEach(btn => {
			const delta = parseFloat(btn.dataset['seek']!);
			btn.addEventListener('click', () => this.seekTo(this.currentTime + delta));
		});

		this.ui.speedBtns.forEach(btn => {
			btn.addEventListener('click', () => {
				this.playRate = parseFloat(btn.dataset['rate']!);
				this.ui.speedBtns.forEach(b => b.classList.toggle('active', b === btn));
			});
		});
	}

	onSimResult(resultData: SimResultData): void {
		this.stopPlayback();
		this.parseResult(resultData.result);
		this.buildScene(resultData.result);
		this.ui.emptyEl.style.display = 'none';
		this.ui.scene.style.display = 'flex';
		this.seekTo(0);
	}

	private parseResult(result: SimResult): void {
		this.fightLen = result.result.firstIterationDuration || result.result.avgIterationDuration || 120;
		this.actions = [];
		this.resources = [];
		this.hitEffects = [];

		this.enemyNames = result.encounterMetrics.targets.map(t => t.name);
		this.numEnemies = Math.max(1, this.enemyNames.length);

		const players = result.raidMetrics.parties.map(p => p.players).flat();
		const playerEntity = players[0] ? new Entity(players[0].name, '', players[0].index, false, false) : null;

		const castBeganLogs: CastBeganLog[] = [];
		const dmgLogs: DamageDealtLog[] = [];
		const resourceLogs: ResourceChangedLog[] = [];

		for (const log of result.logs) {
			if (log.timestamp < 0) continue;
			const l = log as SimLog;
			if (l.isCastBegan()) castBeganLogs.push(l as CastBeganLog);
			else if (l.isDamageDealt()) dmgLogs.push(l as DamageDealtLog);
			else if (l.isResourceChanged()) resourceLogs.push(l as ResourceChangedLog);
		}

		const isRealSpell = (c: CastBeganLog): boolean => {
			const id = c.actionId;
			if (!id) return false;
			if (id.otherId !== OtherAction.OtherActionNone) return false;
			if (!id.spellId && !id.itemId) return false;
			return !!(id.name ?? '');
		};

		const playerCasts = (playerEntity ? castBeganLogs.filter(c => c.source?.equals(playerEntity)) : castBeganLogs).filter(isRealSpell);
		const playerDmg = playerEntity ? dmgLogs.filter(d => d.source?.equals(playerEntity)) : dmgLogs;

		for (const cast of playerCasts) {
			if (!cast.actionId) continue;
			const castName = cast.actionId.name;
			const iconUrl = cast.actionId.iconUrl;

			let dmg: number | null = null;
			let isCrit = false;
			let target: Entity | null = null;

			for (const d of playerDmg) {
				if (d.timestamp < cast.timestamp) continue;
				if (d.timestamp > cast.timestamp + 3) break;
				if (d.actionId?.name === castName && !d.miss && !d.dodge && !d.parry) {
					dmg = d.amount;
					isCrit = d.crit;
					target = d.target;
					break;
				}
			}

			this.actions.push({ time: cast.timestamp, name: castName, iconUrl, dmg, isCrit, target });
		}

		const playerResourceLogs = playerEntity ? resourceLogs.filter(r => r.source?.equals(playerEntity)) : resourceLogs;
		for (const r of playerResourceLogs) {
			this.resources.push({
				time: r.timestamp,
				type: r.resourceType,
				value: r.valueAfter,
				maxValue: RESOURCE_MAX_DEFAULTS[r.resourceType] ?? 100,
			});
		}

		for (const d of playerDmg) {
			if (d.miss || d.dodge || d.parry) continue;
			if (d.actionId && d.actionId.otherId !== OtherAction.OtherActionNone) continue;
			const seed = Math.round(Math.abs(d.timestamp) * 1000);
			this.hitEffects.push({
				time: d.timestamp,
				targetIndex: Math.max(0, this.enemyNames.findIndex(n => n === d.target?.name)),
				x: 20 + (seed * 23 % 60),
				y: 10 + (seed * 37 % 60),
				dmg: d.amount > 0 ? d.amount : null,
				isCrit: d.crit,
			});
		}

		this.preloadImages();
	}

	private preloadImages(): void {
		for (const a of this.actions) {
			if (!a.iconUrl || this.preloadedUrls.has(a.iconUrl)) continue;
			this.preloadedUrls.add(a.iconUrl);
			new Image().src = a.iconUrl;
		}
	}

	private buildScene(result: SimResult): void {
		const players = result.raidMetrics.parties.map(p => p.players).flat();
		const playerName = players[0]?.name ?? i18n.t('combat_replay.default_player');

		const labelEl = this.rootElem.querySelector<HTMLElement>('.cr-cdm-player-label')!;
		labelEl.textContent = playerName;

		const seen = new Map<string, ReplayAction>();
		for (const a of this.actions) {
			if (!seen.has(a.name)) seen.set(a.name, a);
		}

		this.ui.actionGridEl.innerHTML = '';
		for (const [, action] of seen) {
			const div = document.createElement('div');
			div.className = 'cr-action-icon';
			div.dataset['key'] = action.name;
			const img = document.createElement('img');
			img.src = action.iconUrl;
			img.alt = action.name;
			img.draggable = false;
			div.appendChild(img);
			this.ui.actionGridEl.appendChild(div);
		}

		this.buildEnemyZone();

		this.ui.scrubber.max = '1000';
		this.ui.scrubber.value = '0';
		this.currentTime = 0;
	}

	private buildEnemyZone(): void {
		const n = Math.min(this.numEnemies, MAX_ENEMIES);
		const imgWidthPct = n === 1 ? 70 : n <= 2 ? 45 : n <= 4 ? 28 : 18;

		this.ui.enemyZone.innerHTML = '';
		const row = document.createElement('div');
		row.className = 'cr-enemy-row';

		for (let i = 0; i < n; i++) {
			const name = this.enemyNames[i] ?? i18n.t('combat_replay.training_dummy');
			const card = document.createElement('div');
			card.className = 'cr-enemy-card';
			card.style.width = `${imgWidthPct}%`;
			card.dataset['idx'] = String(i);
			card.innerHTML = `
				<div class="cr-nameplate">
					<div class="cr-enemy-name">${this.esc(name)}</div>
					<div class="cr-hp-bar">
						<div class="cr-hp-fill" style="width:100%"></div>
						<span class="cr-hp-text">100.0%</span>
					</div>
				</div>
				<div class="cr-silhouette">
					<img src="${BOSS_IMAGE_URL}" alt="${this.esc(name)}" draggable="false">
					<div class="cr-hit-layer"></div>
				</div>
			`;
			row.appendChild(card);
		}

		if (this.numEnemies > MAX_ENEMIES) {
			const more = document.createElement('div');
			more.className = 'cr-enemy-more';
			more.textContent = `+${this.numEnemies - MAX_ENEMIES}`;
			row.appendChild(more);
		}

		this.ui.enemyZone.appendChild(row);
	}

	private seekTo(t: number): void {
		this.currentTime = Math.max(0, Math.min(t, this.fightLen));
		this.renderFrame();
	}

	private renderFrame(): void {
		const t = this.currentTime;

		this.ui.scrubber.value = String(Math.round((t / Math.max(this.fightLen, 0.001)) * 1000));
		this.ui.timeDisplay.textContent = `${this.fmt(t)} / ${this.fmt(this.fightLen)}`;

		let actionIdx = -1;
		for (let i = 0; i < this.actions.length; i++) {
			if (this.actions[i].time <= t) actionIdx = i;
			else break;
		}

		this.renderTicker(this.actions.filter(a => a.time <= t).slice(-MAX_TICKER));
		this.renderCastBar(actionIdx, t);
		this.renderResources(t);
		this.renderActionHighlights(actionIdx, t);
		this.renderEnemies(t);
	}

	private renderTicker(casts: ReplayAction[]): void {
		const newKeys = casts.map(c => `${c.time}|${c.name}`);
		const existing = Array.from(this.ui.tickerTrack.children) as HTMLElement[];
		const existingKeys = existing.map(el => el.dataset['key'] ?? '');

		if (existingKeys.length === newKeys.length && existingKeys.every((k, i) => k === newKeys[i])) {
			existing.forEach((el, i) => {
				const isLatest = i === casts.length - 1;
				el.classList.toggle('cr-strip-icon-active', isLatest);
				el.style.opacity = String(isLatest ? 1 : 0.25 + 0.6 * (i / Math.max(1, casts.length - 1)));
			});
			return;
		}

		const newKeySet = new Set(newKeys);
		const reusable = new Map<string, HTMLElement>();
		for (const el of existing) {
			const key = el.dataset['key'] ?? '';
			if (newKeySet.has(key)) reusable.set(key, el);
		}

		this.ui.tickerTrack.innerHTML = '';

		casts.forEach((cast, i) => {
			const key = `${cast.time}|${cast.name}`;
			const isLatest = i === casts.length - 1;

			let slot = reusable.get(key);
			if (!slot) {
				slot = document.createElement('div');
				slot.dataset['key'] = key;

				const img = document.createElement('img');
				img.src = cast.iconUrl;
				img.alt = cast.name;
				img.draggable = false;
				slot.appendChild(img);

				if (cast.isCrit) {
					const badge = document.createElement('span');
					badge.className = 'cr-crit-badge';
					badge.textContent = '!';
					slot.appendChild(badge);
				}
				if (cast.dmg != null && cast.dmg > 0) {
					const badge = document.createElement('span');
					badge.className = 'cr-dmg-badge';
					badge.textContent = cast.dmg >= 1000 ? `${(cast.dmg / 1000).toFixed(1)}k` : String(Math.round(cast.dmg));
					slot.appendChild(badge);
				}
			}

			slot.className = 'cr-strip-icon' + (isLatest ? ' cr-strip-icon-active' : '');
			slot.style.opacity = String(isLatest ? 1 : 0.25 + 0.6 * (i / Math.max(1, casts.length - 1)));
			this.ui.tickerTrack.appendChild(slot);
		});
	}

	private renderCastBar(actionIdx: number, t: number): void {
		if (actionIdx < 0) {
			this.ui.castBarFill.style.width = '0%';
			this.ui.castBarLabel.textContent = '';
			this.ui.castBarTime.textContent = '';
			return;
		}

		const currentAction = this.actions[actionIdx];
		let nextTime = this.fightLen;
		for (let i = actionIdx + 1; i < this.actions.length; i++) {
			nextTime = this.actions[i].time;
			break;
		}

		const castDur = nextTime - currentAction.time;
		if (castDur <= 1.5 || castDur > 10) {
			this.ui.castBarFill.style.width = '0%';
			this.ui.castBarLabel.textContent = '';
			this.ui.castBarTime.textContent = '';
			return;
		}

		const elapsed = t - currentAction.time;
		this.ui.castBarFill.style.width = `${Math.min(1, elapsed / castDur) * 100}%`;
		this.ui.castBarLabel.textContent = currentAction.name;
		this.ui.castBarTime.textContent = `${Math.max(0, castDur - elapsed).toFixed(1)}s`;
	}

	private renderResources(t: number): void {
		const latest = new Map<ResourceType, ResourceSnapshot>();
		for (const snap of this.resources) {
			if (snap.time <= t) latest.set(snap.type, snap);
		}

		if (latest.size === 0) {
			this.ui.resourceBarsEl.innerHTML = '';
			return;
		}

		const priority = [
			ResourceType.ResourceTypeMana,
			ResourceType.ResourceTypeEnergy,
			ResourceType.ResourceTypeRage,
			ResourceType.ResourceTypeFocus,
			ResourceType.ResourceTypeRunicPower,
			ResourceType.ResourceTypeChi,
		];
		let primaryType: ResourceType | null = null;
		for (const p of priority) {
			if (latest.has(p)) { primaryType = p; break; }
		}

		const types = Array.from(latest.keys());
		const orderedTypes = primaryType ? [primaryType, ...types.filter(rt => rt !== primaryType)] : types;

		let html = '';
		for (const rt of orderedTypes) {
			if (rt === ResourceType.ResourceTypeNone) continue;
			const snap = latest.get(rt)!;
			const color = resourceColors.get(rt) ?? '#94a3b8';
			const label = resourceNames.get(rt) ?? String(rt);

			if (DOT_RESOURCE_TYPES.has(rt)) {
				const maxDots = Math.round(snap.maxValue);
				const filled = Math.round(snap.value);
				const segments = Array.from({ length: maxDots }, (_, i) =>
					`<div class="cr-segment" style="background:${i < filled ? `linear-gradient(180deg,${color}ee,${color}99)` : 'rgba(255,255,255,0.07)'};box-shadow:${i < filled ? `0 0 8px ${color}88` : 'none'}"></div>`,
				).join('');
				html += `<div class="cr-resource-wrap"><div class="cr-seg-bar">${segments}<span class="cr-bar-label">${label}</span><span class="cr-bar-val">${filled}/${maxDots}</span></div></div>`;
			} else {
				const pct = snap.maxValue > 0 ? Math.min(1, Math.max(0, snap.value / snap.maxValue)) : 0;
				html += `<div class="cr-resource-wrap"><div class="cr-res-bar-outer"><div class="cr-res-bar-fill" style="width:${pct * 100}%;background:linear-gradient(90deg,${color}88,${color}dd);box-shadow:0 0 10px ${color}55"></div><span class="cr-bar-label">${label}</span><span class="cr-bar-val">${Math.round(snap.value)}/${Math.round(snap.maxValue)}</span></div></div>`;
			}
		}
		this.ui.resourceBarsEl.innerHTML = html;
	}

	private renderActionHighlights(actionIdx: number, t: number): void {
		const recent = new Set<string>();
		for (let i = actionIdx; i >= 0 && i >= actionIdx - 5; i--) {
			const a = this.actions[i];
			if (!a || t - a.time > 0.6) break;
			recent.add(a.name);
		}
		this.ui.actionGridEl.querySelectorAll<HTMLElement>('.cr-action-icon').forEach(el => {
			el.classList.toggle('cr-action-icon-active', recent.has(el.dataset['key'] ?? ''));
		});
	}

	private renderEnemies(t: number): void {
		const totalDmg: Record<number, number> = {};
		const cumDmg: Record<number, number> = {};

		for (const h of this.hitEffects) {
			const ti = h.targetIndex;
			totalDmg[ti] = (totalDmg[ti] ?? 0) + (h.dmg ?? 0);
			if (h.time <= t) cumDmg[ti] = (cumDmg[ti] ?? 0) + (h.dmg ?? 0);
		}

		const n = Math.min(this.numEnemies, MAX_ENEMIES);
		for (let i = 0; i < n; i++) {
			const card = this.ui.enemyZone.querySelector<HTMLElement>(`.cr-enemy-card[data-idx="${i}"]`);
			if (!card) continue;

			const hpPct = Math.max(0, 1 - (cumDmg[i] ?? 0) / Math.max(1, totalDmg[i] ?? 1));
			card.querySelector<HTMLElement>('.cr-hp-fill')!.style.width = `${hpPct * 100}%`;
			card.querySelector<HTMLElement>('.cr-hp-text')!.textContent = `${(hpPct * 100).toFixed(1)}%`;

			const layer = card.querySelector<HTMLElement>('.cr-hit-layer')!;
			const activeHits = this.hitEffects.filter(h => h.targetIndex === i && t - h.time >= 0 && t - h.time <= DMG_WINDOW_SEC);

			layer.innerHTML = '';
			for (const hit of activeHits) {
				const age = t - hit.time;
				const p = Math.min(1, age / HIT_WINDOW_SEC);
				const ep = 1 - (1 - p) * (1 - p);
				const dp = Math.min(1, age / DMG_WINDOW_SEC);
				const flashSize = 14 + ep * 28;
				const ringSize = 24 + ep * 72;
				const alpha = Math.max(0, 1 - p);
				const ringAlpha = Math.max(0, (1 - p) * 0.85);
				const floatY = dp < 0.3 ? (dp / 0.3) * 28 : 28 + ((dp - 0.3) / 0.7) * 14;
				const numOpacity = dp < 0.15 ? dp / 0.15 : dp > 0.6 ? Math.max(0, 1 - (dp - 0.6) / 0.4) : 1;
				const numScale = dp < 0.1 ? 1.4 - (dp / 0.1) * 0.4 : 1;
				const ringColor = hit.isCrit ? '#ff8040' : '#c0a060';
				const dmgStr =
					hit.dmg == null ? '' : hit.dmg >= 1000000 ? `${(hit.dmg / 1000000).toFixed(2)}M` : hit.dmg >= 1000 ? `${(hit.dmg / 1000).toFixed(1)}K` : String(Math.round(hit.dmg));

				layer.insertAdjacentHTML(
					'beforeend',
					`<div class="cr-hit-effect" style="left:${hit.x}%;top:${hit.y}%">
						<div class="cr-hit-flash" style="width:${flashSize}px;height:${flashSize}px;opacity:${alpha * (hit.isCrit ? 1 : 0.85)}"></div>
						<div class="cr-hit-ring" style="width:${ringSize}px;height:${ringSize}px;opacity:${ringAlpha};border-color:${ringColor};box-shadow:0 0 ${6 + ep * 10}px ${ringColor}"></div>
						${hit.isCrit ? `<div class="cr-hit-ring" style="width:${ringSize * 1.6}px;height:${ringSize * 1.6}px;opacity:${ringAlpha * 0.5};border-color:#ffcc40"></div>` : ''}
						${hit.dmg != null ? `<div class="cr-dmg-num${hit.isCrit ? ' cr-dmg-crit' : ''}" style="opacity:${numOpacity};transform:translate(-50%,calc(-50% - ${floatY}px)) scale(${numScale})">${dmgStr}</div>` : ''}
					</div>`,
				);
			}
		}
	}

	private play(): void {
		if (this.isPlaying) return;
		if (this.currentTime >= this.fightLen) this.seekTo(0);
		this.isPlaying = true;
		this.lastRaf = null;
		this.ui.playBtn.textContent = '⏸';
		this.rafId = requestAnimationFrame(ts => this.tick(ts));
	}

	private pause(): void {
		if (!this.isPlaying) return;
		this.isPlaying = false;
		if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
		this.ui.playBtn.textContent = '▶';
	}

	private tick(ts: number): void {
		if (!this.isPlaying) return;
		if (this.lastRaf !== null) {
			const next = this.currentTime + ((ts - this.lastRaf) / 1000) * this.playRate;
			if (next >= this.fightLen) {
				this.seekTo(this.fightLen);
				this.pause();
				return;
			}
			this.seekTo(next);
		}
		this.lastRaf = ts;
		this.rafId = requestAnimationFrame(ts2 => this.tick(ts2));
	}

	stopPlayback(): void {
		this.pause();
		this.seekTo(0);
	}

	private fmt(s: number): string {
		const m = Math.floor(s / 60);
		return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
	}

	private esc(str: string): string {
		return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
}
