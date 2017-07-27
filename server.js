'use strict';

const fs = require('fs');
const express = require('express');
const server = express();

// const bodyParser = require('body-parser');
// server.use(bodyParser.json());
// to support URL-encoded bodies
// server.use(bodyParser.urlencoded({extended: true}));
// server.use(bodyParser.raw({
//     inflate: true,
//     limit: '20000kb',
//     type: '*/*',
// }));

// convenient self-kill
// server.get('/stopserver', (req, res) => {
//     console.log('Complying to stop server query');
//     res.status(200).end('KTHXBYE');
//     setTimeout(process.exit, 500);
// });

// set the favicon
const favicon = require('serve-favicon');
server.use(favicon(`${__dirname}/static/favicon.ico`));

// fallthrough to static content
server.use(express.static(`${__dirname}/static`));

console.log('Ready');
server.listen(9000);
