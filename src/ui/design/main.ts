// Entry of the design prototype (design.html, dev server only; not part of the app build).
import { mount } from 'svelte';
import Design from './Design.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app missing in design.html');

export default mount(Design, { target });
