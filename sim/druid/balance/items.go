package balance

import (
	"time"

	"github.com/wowsims/mop/sim/core"
	"github.com/wowsims/mop/sim/core/stats"
	"github.com/wowsims/mop/sim/druid"
)

// T14 Balance
var ItemSetRegaliaOfTheEternalBloosom = core.NewItemSet(core.ItemSet{
	Name:                    "Regalia of the Eternal Blossom",
	DisabledInChallengeMode: true,
	Bonuses: map[int32]core.ApplySetBonus{
		2: func(_ core.Agent, setBonusAura *core.Aura) {
			// Your Starfall deals 20% additional damage.
			setBonusAura.AttachSpellMod(core.SpellModConfig{
				Kind:       core.SpellMod_DamageDone_Pct,
				ClassMask:  druid.DruidSpellStarfall,
				FloatValue: 0.2,
			})
		},
		4: func(_ core.Agent, setBonusAura *core.Aura) {
			// Increases the duration of your Moonfire and Sunfire spells by 2 sec.
			setBonusAura.AttachSpellMod(core.SpellModConfig{
				Kind:      core.SpellMod_DotNumberOfTicks_Flat,
				ClassMask: druid.DruidSpellMoonfireDoT | druid.DruidSpellSunfireDoT,
				IntValue:  1,
			})
		},
	},
})

// T15 Balance
var ItemSetRegaliaOfTheHauntedForest = core.NewItemSet(core.ItemSet{
	Name:                    "Regalia of the Haunted Forest",
	DisabledInChallengeMode: true,
	Bonuses: map[int32]core.ApplySetBonus{
		2: func(_ core.Agent, setBonusAura *core.Aura) {
			// Increases the critical strike chance of Starsurge by 10%.
			setBonusAura.AttachSpellMod(core.SpellModConfig{
				Kind:       core.SpellMod_BonusCrit_Percent,
				ClassMask:  druid.DruidSpellStarsurge,
				FloatValue: 10,
			})
		},
		4: func(agent core.Agent, setBonusAura *core.Aura) {
			// Nature's Grace now also grants 1000 critical strike and 1000 mastery for its duration.
			druid := agent.(*BalanceDruid)
			aura := druid.NewTemporaryStatsAura(
				"Druid T15 Balance 4P Bonus",
				core.ActionID{SpellID: 138350},
				stats.Stats{stats.CritRating: 1000, stats.MasteryRating: 1000},
				time.Second*15,
			)

			druid.Env.RegisterPreFinalizeEffect(func() {
				druid.NaturesGrace.ApplyOnGain(func(_ *core.Aura, sim *core.Simulation) {
					if setBonusAura.IsActive() {
						aura.Activate(sim)
					}
				})
			})

			setBonusAura.ExposeToAPL(138350)
		},
	},
})

// T16 Balance
var ItemSetRegaliaOfTheShatteredVale = core.NewItemSet(core.ItemSet{
	Name:                    "Regalia of the Shattered Vale",
	ID:                      1197,
	DisabledInChallengeMode: true,
	Bonuses: map[int32]core.ApplySetBonus{
		2: func(agent core.Agent, setBonusAura *core.Aura) {
			// Arcane spells cast while in Lunar Eclipse will shoot a single Lunar Bolt at the target. Nature spells cast while in a Solar Eclipse will shoot a single Solar Bolt at the target.
			moonkin := agent.(*BalanceDruid)
			solarBolt := moonkin.registerT15BoltSpell(144772, core.SpellSchoolNature, SolarEclipse)
			lunarBolt := moonkin.registerT15BoltSpell(144770, core.SpellSchoolArcane, LunarEclipse)

			setBonusAura.AttachProcTrigger(core.ProcTrigger{
				Callback:       core.CallbackOnSpellHitDealt,
				ClassSpellMask: druid.DruidArcaneSpells | druid.DruidNatureSpells,
				Outcome:        core.OutcomeLanded,

				Handler: func(sim *core.Simulation, spell *core.Spell, result *core.SpellResult) {
					// Nature spells (Wrath, Sunfire) in Solar Eclipse trigger Solar Bolt
					if spell.Matches(druid.DruidNatureSpells &^ druid.DruidSpellDoT) {
						solarBolt.Cast(sim, result.Target)
					}

					// Arcane spells (Starfire, Moonfire) in Lunar Eclipse trigger Lunar Bolt
					if spell.Matches(druid.DruidArcaneSpells &^ druid.DruidSpellDoT) {
						lunarBolt.Cast(sim, result.Target)
					}
				},
			})
		},
		4: func(agent core.Agent, setBonusAura *core.Aura) {
			// Your chance to get Shooting Stars from a critical strike from Moonfire or Sunfire is increased by 8%.
			moonkin := agent.(*BalanceDruid)
			moonkin.ShootingStarsProcChance += 0.08
		},
	},
})

const (
	T15BoltBonusCoeff = 0.10000000149
	T15BoltCoeff      = 0.5
	T15BoltVariance   = 0.25
)

func (moonkin *BalanceDruid) registerT15BoltSpell(spellID int32, spellSchool core.SpellSchool, eclipse Eclipse) *druid.DruidSpell {
	return moonkin.RegisterSpell(druid.Humanoid|druid.Moonkin, core.SpellConfig{
		ActionID:    core.ActionID{SpellID: spellID},
		SpellSchool: spellSchool,
		ProcMask:    core.ProcMaskSpellDamage,
		Flags:       core.SpellFlagAPL,

		BonusCoefficient: T15BoltBonusCoeff,
		DamageMultiplier: 1,
		CritMultiplier:   moonkin.DefaultCritMultiplier(),
		ThreatMultiplier: 1,

		ApplyEffects: func(sim *core.Simulation, target *core.Unit, spell *core.Spell) {
			baseDamage := moonkin.CalcAndRollDamageRange(sim, T15BoltCoeff, T15BoltVariance)
			spell.CalcAndDealDamage(sim, target, baseDamage, spell.OutcomeMagicHitAndCrit)
		},

		ExtraCastCondition: func(sim *core.Simulation, target *core.Unit) bool {
			return (moonkin.IsInEclipse() && moonkin.currentEclipse == eclipse) || moonkin.CelestialAlignment.RelatedSelfBuff.IsActive()
		},
	})
}

func init() {}
