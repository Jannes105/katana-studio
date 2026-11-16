import { mount } from 'svelte';
import App from './ui/App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app missing in index.html');

export default mount(App, { target });
