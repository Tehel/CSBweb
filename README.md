DM js
=====

### Aim

Make Dungeon Master (Original Atari ST version) playable on any support, through the web browser.

### How

This port is based on the awsome CSBWin version, itself done by unassembling the Atari ST binary and making it a C++ version.

So this is a Javascript rewriting of the C++ version. Datafile are still the original ones (with a door opened using custom ones later).

### Making it work

This is a web project, so it needs to be served by a server. Currently there's no server-side code, so any will do.

I use a Node.js one, with Express framework. Just install Node.js, "npm install" in root dir, "node server.js" and open your web brower on port 9000.

## People

The original authors of Dungeon Master at FTL Games / Software Heaven, Inc. Doug Bell (Director), Dennis Walker (Assistant director), Mike Newton (2nd unit director), Andy Jaros (Graphics), and Wayne Holder (Producer). 

[Paul R. Stevens](http://www.dianneandpaul.net/CSBwin/) for the crazy work of making CSBWin.

Awsome [DMweb community](http://dmweb.free.fr) for the continuous love for the original game over all these years.
People at [Swoosh Construction Kit](http://greatstone.free.fr/dm) for detailed reverse-engineering of `all` the data file structures.

[List of all contributors](https://github.com/expressjs/express/graphs/contributors). Mostly me, I'm afraid.

## License

[MIT](LICENSE) for the JS code

The data files, manual and intellectual property for most of the game processing still go to their original authors at FTL Games / Software Heaven, Inc.
