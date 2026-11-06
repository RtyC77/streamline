// Local UI harness only; Vite's production entry never includes this file.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ShareOptions} from '../../src/components/ShareOptions';
import '../../src/styles.css';
createRoot(document.getElementById('root')).render(<ShareOptions onClose={()=>{}} onShare={profile=>{document.body.dataset.selection=JSON.stringify(profile);}}/>);
