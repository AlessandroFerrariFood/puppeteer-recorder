"use strict";
exports.__esModule = true;
var MAX_INT32 = 99999;
function getAttributes(n) {
    var attrs = [];
    for (var i = 0; i < n.attributes.length; i++) {
        attrs.push(n.attributes[i]);
    }
    return attrs;
}
function getNodeBlocks(n, sortingFilter) {
    var blocks = [
        {
            type: 'tagName',
            name: n.tagName
        }
    ].concat(getAttributes(n)
        .filter(function (a) { return a.name !== 'class'; })
        .map(function (a) {
        return {
            type: 'attribute',
            name: a.name,
            value: a.value ? a.value : undefined
        };
    }), n.className
        .split(/[ ]+/)
        .filter(function (name) { return !!name; })
        .map(function (name) {
        return {
            type: 'class',
            name: name
        };
    }));
    return {
        n: n,
        used: [],
        unused: sortingFilter ? sortingFilter(blocks) : blocks
    };
}
function blockToSel(block) {
    switch (block.type) {
        case 'tagName':
            return block.name;
        case 'attribute':
            return block.value === undefined
                ? "[" + block.name + "]"
                : "[" + block.name + "=\"" + block.value + "\"]";
        case 'class':
            return '.' + block.name;
        case 'nth-child':
            return ":nth-child(" + block.idx + ")";
    }
    throw new Error("Unsupported block.type " + JSON.stringify(block));
}
var type2order = {
    tagName: 0,
    attribute: 2,
    "class": 3,
    'nth-child': 99
};
function blocksRenderSorter(a, b) {
    return type2order[a.type] - type2order[b.type];
}
function nodeToSel(node) {
    var res = node.used.slice().sort(blocksRenderSorter)
        .map(blockToSel)
        .join('');
    return res[0] === ':' ? '*' + res : res;
}
function chainToFullSel(ch) {
    return ch.nodes.reduce(function (acc, node) {
        if (acc.prevNode && acc.prevNode.n === node.n.parentNode && acc.prevNode.used.length) {
            return {
                sel: [acc.sel, '>', nodeToSel(node)].join(' '),
                prevNode: node
            };
        }
        return {
            sel: [acc.sel, nodeToSel(node)].join(' '),
            prevNode: node
        };
    }, { sel: '' }).sel.trim(); // Faccio trim() perché a volte mi trovo a concatenare 
}
function getRelativaMatch(ch, relativeNode) {
    if (ch.__relativeNode !== relativeNode || !ch.__relativeMatch) {
        var fullSel = chainToFullSel(ch);
        // console.log('getRelativaMatch', fullSel, ch);
        ch.__relativeMatch = fullSel
            ? relativeNode.querySelectorAll(fullSel).length
            : MAX_INT32;
        ch.__relativeNode = relativeNode;
    }
    return ch.__relativeMatch;
}
function getFullMatch(ch) {
    if (!ch.__fullMatch) {
        var fullSel = chainToFullSel(ch);
        // console.log('getFullMatch', fullSel, ch);
        ch.__fullMatch = fullSel
            ? document.querySelectorAll(fullSel).length
            : MAX_INT32;
    }
    return ch.__fullMatch;
}
function compareChains(a, b, relativeNode) {
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
function activateUnused(baseBlock, idx) {
    // console.log('activateUnused', baseBlock, idx);
    var unused = baseBlock.unused.slice();
    var used = baseBlock.used.concat([unused.splice(idx, 1)[0]]);
    return {
        n: baseBlock.n,
        used: used,
        unused: unused
    };
}
function replaceNodeInChain(ch, nodeIdx, newBlock) {
    // console.log('replaceNodeInChain', ch, nodeIdx, newBlock);
    var newNodes = ch.nodes.slice();
    newNodes.splice(nodeIdx, 1, newBlock);
    return {
        nodes: newNodes
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
function testOpt(baseCh, relativeNode, nodeIdx, fullActiveCh, idx, bestCh) {
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
    var baseNode = baseCh.nodes[nodeIdx];
    if (idx >= baseNode.unused.length) {
        return baseCh;
    }
    var testCh = replaceNodeInChain(baseCh, nodeIdx, activateUnused(baseNode, idx));
    var testFullRes = compareChains(testCh, fullActiveCh, relativeNode);
    if (testFullRes === 0) {
        // Non posso migliorare ulteriormente operando su questo nodo
        if (getRelativaMatch(testCh, relativeNode) > 1 &&
            nodeIdx + 1 < testCh.nodes.length) {
            // Passo ad ottimizzare il nodo successivo
            return optimizeChainNodeStep(testCh, relativeNode, nodeIdx + 1);
        }
        else {
            // Completamente ottimizzata
            return testCh;
        }
    }
    var testRes = compareChains(testCh, bestCh, relativeNode);
    if (testRes === -1) {
        bestCh = testCh;
    }
    if (idx + 1 < baseNode.unused.length) {
        // Continuo la ricerca
        return testOpt(baseCh, relativeNode, nodeIdx, fullActiveCh, idx + 1, bestCh);
    }
    else {
        // Ho il massimo a questo livello -> lo fisso e provo ad aggiungerne altri
        return testOpt(bestCh, relativeNode, nodeIdx, fullActiveCh, 0, bestCh);
    }
}
function optimizeChainNodeStep(ch, relativeNode, nodeIdx) {
    // console.log('optimizeChainNodeStep', ch, relativeNode, nodeIdx);
    // Prima guarda con tutte attive per vedere dove può arrivare.
    var currentNode = ch.nodes[nodeIdx];
    var fullActiveNode = {
        n: currentNode.n,
        used: currentNode.used.concat(currentNode.unused),
        unused: []
    };
    var faNodes = ch.nodes.slice();
    faNodes.splice(nodeIdx, 1, fullActiveNode);
    var fullActiveCh = {
        nodes: faNodes
    };
    return testOpt(ch, relativeNode, nodeIdx, fullActiveCh, 0, ch);
}
function getChildrenIndex(n) {
    var relativeNode = n.parentNode;
    for (var i = 0; i < relativeNode.childNodes.length; i++) {
        if (relativeNode.childNodes[i] === n) {
            return i;
        }
    }
    throw new Error('Child not found');
}
function optimizeChainStep(ch, relativeNode, hierarchyNodes) {
    // console.log('optimizeChainStep', ch, relativeNode);
    var bestCh = optimizeChainNodeStep(ch, relativeNode, 0);
    // TODO - Se è già arrivato a fine catena ed è ancora > 1 usa nth-child(x)
    if (getRelativaMatch(bestCh, relativeNode) > 1) {
        var baseNode = bestCh.nodes[0];
        var childOfRelativeNodeToGo = hierarchyNodes[hierarchyNodes.indexOf(relativeNode) - 1];
        return replaceNodeInChain(bestCh, 0, {
            n: baseNode.n,
            used: [
                {
                    type: 'nth-child',
                    idx: getChildrenIndex(childOfRelativeNodeToGo) + 1
                },
            ],
            unused: baseNode.used.concat(baseNode.unused)
        });
    }
    return bestCh;
}
function getNewChainStep(ch, relativeNode) {
    var fullSel = chainToFullSel(ch);
    // console.log('getNewChainStep', fullSel, ch, relativeNode);
    // Verifico se ho già finito per evitare iterazioni inutili
    if (fullSel && document.querySelectorAll(fullSel).length === 1) {
        return undefined;
    }
    while (relativeNode && relativeNode.parentNode) {
        relativeNode = relativeNode.parentNode;
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
function getAncestorNodes(n) {
    if (!n.parentNode) {
        return [];
    }
    return [
        n.parentNode
    ].concat(getAncestorNodes(n.parentNode));
}
var defaultSortingFilter = function (blocks) {
    return blocks.filter(function (b) { return b.type !== 'attribute' || b.name !== 'value'; });
};
function finder(n, sortingFilter) {
    if (sortingFilter === void 0) { sortingFilter = defaultSortingFilter; }
    var hierarchyNodes = [n].concat(getAncestorNodes(n));
    var ch = {
        nodes: []
    };
    var relativeNode = n.parentNode;
    do {
        /**
         * Aggiungo alla catena il figlio del nodo di snodo (relativeNode)
         * che va dalla parte giusta.
         * Su quello dovrò trovare un selector che mi faccia andare
         * da quella parte risolvendo quindi l'ambiguità.
         *  */
        var idx = hierarchyNodes.indexOf(relativeNode);
        ch = {
            nodes: [
                getNodeBlocks(hierarchyNodes[idx - 1], sortingFilter)
            ].concat(ch.nodes)
        };
        ch = optimizeChainStep(ch, relativeNode, hierarchyNodes);
        relativeNode = getNewChainStep(ch, relativeNode);
    } while (relativeNode !== undefined);
    // console.log('TEST', document.querySelectorAll(chainToFullSel(ch)));
    return chainToFullSel(ch);
}
exports.finder = finder;
