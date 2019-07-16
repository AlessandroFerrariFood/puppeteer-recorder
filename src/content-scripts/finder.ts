const MAX_INT32 = 99999;

type TSelBlock =
	| {
			type: 'tagName';
			name: string;
	  }
	| {
			type: 'attribute';
			name: string;
			value?: string;
	  }
	| {
			type: 'class';
			name: string;
	  }
	| {
			type: 'nth-child';
			idx: number;
	  };
type TNodeBlock = {
	n: Element;
	used: ReadonlyArray<TSelBlock>;
	unused: ReadonlyArray<TSelBlock>;
};

type TSelChain = {
	nodes: ReadonlyArray<TNodeBlock>;
	__relativeMatch?: number; //NodeListOf<Element>; // CACHE
	__relativeNode?: Element; // FOR relativeMatch INVALIDATION
	__fullMatch?: number; //NodeListOf<Element>; // CACHE
};

type TSortingFilter = (
	blocks: ReadonlyArray<TSelBlock>,
) => ReadonlyArray<TSelBlock>;

function getAttributes(n: Element): Attr[] {
	const attrs = [];
	for (let i = 0; i < n.attributes.length; i++) {
		attrs.push(n.attributes[i]);
	}
	return attrs;
}

function getNodeBlocks(n: Element, sortingFilter?: TSortingFilter): TNodeBlock {
	const blocks: ReadonlyArray<TSelBlock> = [
		{
			type: 'tagName',
			name: n.tagName,
		},
		...getAttributes(n)
			.filter((a) => a.name !== 'class')
			.map<TSelBlock>((a) => {
				return {
					type: 'attribute',
					name: a.name,
					value: a.value ? a.value : undefined,
				};
			}),
		...n.className
			.split(/[ ]+/)
			.filter((name) => !!name)
			.map<TSelBlock>((name) => {
				return {
					type: 'class',
					name,
				};
			}),
	];
	return {
		n,
		used: [],
		unused: sortingFilter ? sortingFilter(blocks) : blocks,
	};
}

type TBlockSelText = string;
function blockToSel(block: TSelBlock): TBlockSelText {
	switch (block.type) {
		case 'tagName':
			return block.name;
		case 'attribute':
			return block.value === undefined
				? `[${block.name}]`
				: `[${block.name}="${block.value}"]`;
		case 'class':
			return '.' + block.name;
		case 'nth-child':
			return `:nth-child(${block.idx})`;
	}
	throw new Error(`Unsupported block.type ${JSON.stringify(block)}`);
}

const type2order = {
	tagName: 0,
	attribute: 2,
	class: 3,
	'nth-child': 99,
};
function blocksRenderSorter(
	a: Readonly<TSelBlock>,
	b: Readonly<TSelBlock>,
): number {
	return type2order[a.type] - type2order[b.type];
}
type TNodeSelText = string;
function nodeToSel(node: TNodeBlock): TNodeSelText {
	const res = [...node.used]
		.sort(blocksRenderSorter)
		.map(blockToSel)
		.join('');
	return res[0] === ':' ? '*' + res : res;
}

type TFullSelText = string;
type TFullSelAccumulator = {sel: string, prevNode?: TNodeBlock};
function chainToFullSel(ch: Readonly<TSelChain>): TFullSelText {
	return ch.nodes.reduce((acc: TFullSelAccumulator, node: TNodeBlock) => {
		if (acc.prevNode && acc.prevNode.n === node.n.parentNode && acc.prevNode.used.length) {
			return {
				sel: [acc.sel, '>', nodeToSel(node)].join(' '),
				prevNode: node,
			};
		}
		return {
			sel: [acc.sel, nodeToSel(node)].join(' '),
			prevNode: node,
		};
	}, {sel: ''}).sel.trim(); // Faccio trim() perché a volte mi trovo a concatenare 
}

function getRelativaMatch(ch: TSelChain, relativeNode: Element): number {
	if (ch.__relativeNode !== relativeNode || !ch.__relativeMatch) {
		const fullSel = chainToFullSel(ch);
		// console.log('getRelativaMatch', fullSel, ch);
		ch.__relativeMatch = fullSel
			? relativeNode.querySelectorAll(fullSel).length
			: MAX_INT32;
		ch.__relativeNode = relativeNode;
	}
	return ch.__relativeMatch as number;
}

function getFullMatch(ch: TSelChain): number {
	if (!ch.__fullMatch) {
		const fullSel = chainToFullSel(ch);
		// console.log('getFullMatch', fullSel, ch);
		ch.__fullMatch = fullSel
			? document.querySelectorAll(fullSel).length
			: MAX_INT32;
	}
	return ch.__fullMatch as number;
}

function compareChains(
	a: TSelChain,
	b: TSelChain,
	relativeNode: Element,
): -1 | 0 | 1 {
	// console.log('compareChains', a, b, relativeNode);
	/**
	 * Confronta da relativeNode (relativeMatch)
	 * In caso di parità va su tutto il document (fullMatch)
	 */
	// Confronta relativeMatch
	if (getRelativaMatch(a, relativeNode) < getRelativaMatch(b, relativeNode)) {
		return -1;
	}
	if (getRelativaMatch(a, relativeNode) > getRelativaMatch(b, relativeNode)) {
		return 1;
	}
	// Verifica cache fullMatch
	// Confronta relativeMatch
	if (getFullMatch(a) < getFullMatch(b)) {
		return -1;
	}
	if (getFullMatch(a) > getFullMatch(b)) {
		return 1;
	}
	// Sono equivalenti
	return 0;
}

function activateUnused(
	baseBlock: Readonly<TNodeBlock>,
	idx: number,
): TNodeBlock {
	// console.log('activateUnused', baseBlock, idx);
	const unused = [...baseBlock.unused];
	const used = [...baseBlock.used, unused.splice(idx, 1)[0]];
	return {
		n: baseBlock.n,
		used,
		unused,
	};
}

function replaceNodeInChain(
	ch: Readonly<TSelChain>,
	nodeIdx: number,
	newBlock: Readonly<TNodeBlock>,
): TSelChain {
	// console.log('replaceNodeInChain', ch, nodeIdx, newBlock);
	const newNodes = [...ch.nodes];
	newNodes.splice(nodeIdx, 1, newBlock);
	return {
		nodes: newNodes,
	};
}

/**
 *
 * @param baseCh chain base su cui aggiungere per ottimizzare
 * @param relativeNode snodo rispetto a cui si sta ottimizzando
 * @param nodeIdx indice del nodo su cui sto ottimizzando
 * @param fullActiveCh chain con nodo di lavoro tutto attivato per vedere il massimo a cui si può arrivare
 * @param idx indice del baseCh.nodes[nodeIdx].unused di cui testare l'attivazione
 * @param bestCh chain migliore fino ad ora
 */
function testOpt(
	baseCh: TSelChain,
	relativeNode: Element,
	nodeIdx: number,
	fullActiveCh: TSelChain,
	idx: number,
	bestCh: TSelChain,
): TSelChain {
	// console.log('testOpt', baseCh, nodeIdx, idx, bestCh);
	/**
	 * ALGORITMO IN SINTESI
	 * Prima guarda tutte attive per vedere dove può arrivare.
	 * Poi parte da vuoto e va avanti.
	 * Se vede se attivando migliora, altrimenti passa alla successiva.
	 * Se migliora valuta se sostituirla o aggiungerla.
	 * Se è già arrivata al meglio si ferma.
	 * POI
	 * Se il meglio è > 1 prova a migliorare il nodo successivo della catena per compensare.
	 * Se è già arrivato a fine catena ed è ancora > 1 usa nth-child(x).
	 */
	if (nodeIdx >= baseCh.nodes.length) {
		return baseCh;
	}
	const baseNode = baseCh.nodes[nodeIdx];
	if (idx >= baseNode.unused.length) {
		return baseCh;
	}
	const testCh = replaceNodeInChain(
		baseCh,
		nodeIdx,
		activateUnused(baseNode, idx),
	);
	const testFullRes = compareChains(testCh, fullActiveCh, relativeNode);
	if (testFullRes === 0) {
		// Non posso migliorare ulteriormente operando su questo nodo
		if (
			getRelativaMatch(testCh, relativeNode) > 1 &&
			nodeIdx + 1 < testCh.nodes.length
		) {
			// Passo ad ottimizzare il nodo successivo
			return optimizeChainNodeStep(testCh, relativeNode, nodeIdx + 1);
		} else {
			// Completamente ottimizzata
			return testCh;
		}
	}
	const testRes = compareChains(testCh, bestCh, relativeNode);
	if (testRes === -1) {
		bestCh = testCh;
	}
	if (idx + 1 < baseNode.unused.length) {
		// Continuo la ricerca
		return testOpt(
			baseCh,
			relativeNode,
			nodeIdx,
			fullActiveCh,
			idx + 1,
			bestCh,
		);
	} else {
		// Ho il massimo a questo livello -> lo fisso e provo ad aggiungerne altri
		return testOpt(bestCh, relativeNode, nodeIdx, fullActiveCh, 0, bestCh);
	}
}

function optimizeChainNodeStep(
	ch: Readonly<TSelChain>,
	relativeNode: Element,
	nodeIdx: number,
): TSelChain {
	// console.log('optimizeChainNodeStep', ch, relativeNode, nodeIdx);
	// Prima guarda con tutte attive per vedere dove può arrivare.
	const currentNode = ch.nodes[nodeIdx];
	const fullActiveNode: TNodeBlock = {
		n: currentNode.n,
		used: [...currentNode.used, ...currentNode.unused],
		unused: [],
	};
	const faNodes = [...ch.nodes];
	faNodes.splice(nodeIdx, 1, fullActiveNode);
	const fullActiveCh: TSelChain = {
		nodes: faNodes,
	};

	return testOpt(ch, relativeNode, nodeIdx, fullActiveCh, 0, ch);
}

function getChildrenIndex(n: Element): number {
	const relativeNode = n.parentNode;
	for (let i: number = 0; i < relativeNode.childNodes.length; i++) {
		if (relativeNode.childNodes[i] === n) {
			return i;
		}
	}
	throw new Error('Child not found');
}

function optimizeChainStep(
	ch: Readonly<TSelChain>,
	relativeNode: Element,
	hierarchyNodes: Element[],
): TSelChain {
	// console.log('optimizeChainStep', ch, relativeNode);
	const bestCh = optimizeChainNodeStep(ch, relativeNode, 0);
	// TODO - Se è già arrivato a fine catena ed è ancora > 1 usa nth-child(x)
	if (getRelativaMatch(bestCh, relativeNode) > 1) {
		const baseNode = bestCh.nodes[0];
		const childOfRelativeNodeToGo =
			hierarchyNodes[hierarchyNodes.indexOf(relativeNode) - 1];
		return replaceNodeInChain(bestCh, 0, {
			n: baseNode.n,
			used: [
				{
					type: 'nth-child',
					idx: getChildrenIndex(childOfRelativeNodeToGo) + 1,
				} as TSelBlock,
			],
			unused: [...baseNode.used, ...baseNode.unused],
		});
	}

	return bestCh;
}

function getNewChainStep(
	ch: Readonly<TSelChain>,
	relativeNode: Element,
): Element | undefined {
	const fullSel = chainToFullSel(ch);
	// console.log('getNewChainStep', fullSel, ch, relativeNode);
	// Verifico se ho già finito per evitare iterazioni inutili
	if (fullSel && document.querySelectorAll(fullSel).length === 1) {
		return undefined;
	}
	while (relativeNode && relativeNode.parentNode) {
		relativeNode = relativeNode.parentNode as Element;
		if (relativeNode.childNodes.length === 1) {
			// Non è uno snodo -> nessuna ambiguità possibile
			continue;
		}
		if (!fullSel || relativeNode.querySelectorAll(fullSel).length > 1) {
			// A questo livello c'è un'ambiguità da risolvere
			return relativeNode;
		}
	}
	// Ho finito di percorrere l'albero
	return undefined;
}

function getAncestorNodes(n: Element): ReadonlyArray<Element> {
	if (!n.parentNode) {
		return [];
	}
	return [
		n.parentNode as Element,
		...getAncestorNodes(n.parentNode as Element),
	];
}

const defaultSortingFilter: TSortingFilter = function(
	blocks: TSelBlock[],
): TSelBlock[] {
	return blocks.filter((b) => b.type !== 'attribute' || b.name !== 'value');
};

export function finder(
	n: Element,
	sortingFilter: TSortingFilter = defaultSortingFilter,
): TFullSelText {
	const hierarchyNodes = [n, ...getAncestorNodes(n)];
	let ch: TSelChain = {
		nodes: [],
	};
	let relativeNode: Element = n.parentNode as Element;
	do {
		/**
		 * Aggiungo alla catena il figlio del nodo di snodo (relativeNode)
		 * che va dalla parte giusta.
		 * Su quello dovrò trovare un selector che mi faccia andare
		 * da quella parte risolvendo quindi l'ambiguità.
		 *  */
		const idx = hierarchyNodes.indexOf(relativeNode);
		ch = {
			nodes: [
				getNodeBlocks(hierarchyNodes[idx - 1], sortingFilter),
				...ch.nodes,
			],
		};
		ch = optimizeChainStep(ch, relativeNode, hierarchyNodes);
		relativeNode = getNewChainStep(ch, relativeNode);
	} while (relativeNode !== undefined);
	// console.log('TEST', document.querySelectorAll(chainToFullSel(ch)));
	return chainToFullSel(ch);
}
