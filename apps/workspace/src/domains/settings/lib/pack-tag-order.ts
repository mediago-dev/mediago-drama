type PackTaggedItem = { packId?: string };
type PackTag = { id: string; name: string; source: string };

const packSourceOrder: Record<string, number> = { default: 0, local: 1, imported: 2 };

export const orderItemsByPackTag = <Item extends PackTaggedItem>(
	items: Item[],
	packs: PackTag[],
) => {
	const packByID = new Map(packs.map((pack) => [pack.id, pack]));
	const originalIndex = new Map(items.map((item, index) => [item, index]));
	return [...items].sort((first, second) => {
		const firstPack = resolvePack(first, packByID);
		const secondPack = resolvePack(second, packByID);
		const sourceDifference = packSourceRank(firstPack.source) - packSourceRank(secondPack.source);
		if (sourceDifference !== 0) return sourceDifference;
		const nameDifference = firstPack.name.localeCompare(secondPack.name, "zh-Hans-CN");
		if (nameDifference !== 0) return nameDifference;
		const idDifference = firstPack.id.localeCompare(secondPack.id);
		if (idDifference !== 0) return idDifference;
		return (originalIndex.get(first) ?? 0) - (originalIndex.get(second) ?? 0);
	});
};

const resolvePack = <Item extends PackTaggedItem>(
	item: Item,
	packByID: Map<string, PackTag>,
): PackTag => {
	const packID = item.packId?.trim() || "builtin";
	return packByID.get(packID) ?? { id: packID, name: packID, source: "local" };
};

const packSourceRank = (source: string) => packSourceOrder[source] ?? packSourceOrder.local;
