# File explanation

| File                 | Description             |
| -------------------- | ----------------------- |
| `sluz.js`            | Primary ES module       |
| `sluz.min.js`        | Minified ES module      |
| `sluz.global.js`     | Global wrapper          |
| `sluz.global.min.js` | Minified global version |

---------------------------

The ESM version requires JavaScript module syntax to load.
```html
<script type="module">
    import Sluz from './js/template-sluz/+esm';
    const sluz = new Sluz();

    sluz.assign('user', { name: 'Alice', role: 'admin' });
    document.body.innerHTML = sluz.parse("Welcome {$user.name} you are {$user.role}");
</script>
```

The global version creates `Sluz` in the global namespace.
```html
<script src="js/sluz.global.min.js"></script>
<script>
    const sluz = new Sluz();
    sluz.assign('user', { name: 'Alice', role: 'admin' });

    document.body.innerHTML = sluz.parse("Welcome {$user.name} you are {$user.role}");
</script>
```

The minified version of the files can be rebuilt with the `npm run build` command.
