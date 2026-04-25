import { Player } from '../core/player';
import { Spec } from '../core/proto/common';

// Gets the GCD cap breakpoint for Paladins
// Will offset based on Melee Haste buff presence and Seal of Insight presence to preserve the same rating-equivalent breakpoint in all scenarios.
export const getGCDCapBreakpoint = (player: Player<Spec.SpecProtectionPaladin> | Player<Spec.SpecRetributionPaladin>): number => {
	const raidBuffs = player.getRaid()?.getBuffs()!;

	const hasMeleeHaste = [
		raidBuffs.unholyAura,
		raidBuffs.cacklingHowl,
		raidBuffs.serpentsSwiftness,
		raidBuffs.swiftbladesCunning,
		raidBuffs.unleashedRage,
	].some(Boolean);

	let targetPercent = 50;
	if (hasMeleeHaste) {
		targetPercent += 15;
	}

	return targetPercent;
};
