import OBR from '@owlbear-rodeo/sdk';
import add from './src/assets/add.svg';
import remove from './src/assets/remove.svg';
import {installInitiativeMenus} from './contextMenu.js';
OBR.onReady(()=>{void installInitiativeMenus(OBR,{add,remove}).catch(error=>console.error('[Avallon Initiative] Context menu registration failed',error));});
