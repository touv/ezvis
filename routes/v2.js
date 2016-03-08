/*jshint node:true, laxcomma:true */
'use strict';

var path = require('path')
  , basename = path.basename(__filename, '.js')
  , debug = require('debug')('castor:routes:' + basename)
  , datamodel = require('datamodel')
  , express =  require('express')
  , bodyParser = require('body-parser')
  ;

module.exports = function(router, core) {

  router.route('/-/v2/browse.json').all(require('./v2/browse.js')(core));
  // router.route('/-/v2/corpus.:format').all(require('./v2/corpus.js')(core));
  router.route('/-/v2/compute.json').all(require('./v2/compute.js')(core));
  /*
  router.route('/-/v2//display/:doc.:format').all(require('./routes/display.js')(config));
  router.route('/-/v2/dump/:doc.:format').all(require('./routes/dump.js')(config));
  router.route('/-/v2/save/:doc').all(bodyParser.urlencoded({ extended: false })).post(require('./routes/save.js')(config));
  router.route('/-/v2/drop/:doc').all(bodyParser.urlencoded({ extended: false })).post(require('./routes/drop.js')(config));
  */
  return router;
};
