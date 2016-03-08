/*jshint node:true,laxcomma:true*/
'use strict';

var path = require('path')
  , basename = path.basename(__filename, '.js')
  , debug = require('debug')('castor:routes:' + basename)
  , util = require('util')
  , crypto = require('crypto')
  , datamodel = require('datamodel')
  , Flying = require('../../helpers/flying.js')
  , struct = require('object-path')
  , extend = require('extend')
  ;

module.exports = function(core) {
  var config = core.config;
  var computer = core.computer;
  var heart = core.heart;
  var pulse = heart.newPulse();
  var lock;
  var first = [];
  var flyopts = {
    "connectionURI" : config.get('connectionURI'),
    "collectionName": config.get('collectionName'),
    "concurrency" : config.get('concurrency')
  }
, fly = new Flying(config.get('flyingFields'), flyopts)
;


return datamodel()
.declare('template', function(req, fill) {
    fill(basename + '.html');
})
.declare('site', function(req, fill) {
    fill({
        title : config.get('title'),
        description : config.get('description')
    });
})
.declare('page', function(req, fill) {
    fill({
        title : config.get('pages:' + req.params.name + ':title'),
        description : config.get('pages:' + req.params.name + ':description'),
        types : ['text/html', 'application/json']
    });
})
.declare('user', function(req, fill) {
    fill(req.user ? req.user : {});
})
.declare('config', function(req, fill) {
    fill(config.get());
})
.declare('url', function(req, fill) {
    fill(require('url').parse(req.protocol + '://' + req.get('host') + req.originalUrl));
})

.declare('mongoSort', function(req, fill) {
    var s = {};
    if (Array.isArray(req.query.order)) {
      req.query.order.forEach(function(itm) {
          if (req.query.columns && req.query.columns[itm.column] && req.query.columns[itm.column].data) {
            s[req.query.columns[itm.column].data] = itm.dir === 'asc' ? 1 : -1;
          }
      });
    }
    fill(s);
})
.declare('parameters', function(req, fill) {
    var schema = {
      "field" : {
        "alias": "f",
        "type" : "text",
        "array": true,
        "required" : true,
        "pattern" : "^[a-zA-Z-][a-zA-Z0-9. _-]*$"
      },
      "operator" : {
        "alias": "o",
        "type" : "text",
        "pattern" : "^[a-z][a-z0-9. _-]+$",
        "required" : true,
        "values" : computer.operators()
      },
      "selector" : {
        "alias": ["sel", "select"],
        "type" : "text"
      },
      "query" : {
        "alias": ["q"],
        "type": "text"
      },
      "itemsPerPage" : {
        "alias": ["count", "length", "l"],
        "type" : "number",
        "required" : false
      },
      "startIndex" : {
        "alias": ["start", "i"],
        "type" : "number",
        "required" : false
      },
      "startPage" : {
        "alias": ["page", "p"],
        "type" : "number",
        "required" : false
      },
      // see http://datatables.net/manual/server-side
      "search" : {
        "alias": [ "s"],
        "type" : "object",
        "required" : false
      },
      "order" : {
        "alias": ["sort"],
        "type" : "object",
        "required" : false,
        "array": true
      },
      "columns" : {
        "alias": ["cols"],
        "type" : "object",
        "required" : false,
        "array": true
      },
      "flying" : {
        "alias": ["flyingFields", "ff"],
        "type" : "string",
        "required" : false,
        "array": true
      },
      "resource" : {
        "alias": ["r", "rsc"],
        "type" : "string",
        "required" : false,
        "values": Object.keys(config.get('resources'))
      },
      "firstOnly" : {
        "alias": ["fo"],
        "type" : "boolean",
        "required" : false
      }
    };
    var form = require('formatik').parse(req.query, schema);
    if (form.isValid()) {
      var v = form.mget('value');
      if (v.itemsPerPage === undefined || v.itemsPerPage === null) {
        v.itemsPerPage = config.get('itemsPerPage');
      }
      if (v.startPage) {
        v.startIndex = (v.startPage - 1) * v.itemsPerPage;
      }
      if (!v.startIndex) {
        v.startIndex = 0;
      }
      if (!v.resource) {
        v.resource = config.get('collectionName');
      }
      else {
        v.resource = config.get('collectionName') + '_resources_' + v.resource;
      }
      fill(v);
    }
    else {
      fill(false);
    }
})
.prepend('mongoCollection', function(req, fill) {
    var self = this;
    core.connect().then(function(db) {
        db.collection(config.get('collectionsIndexName')).findOne({
            "_root" : true
        }).then(function(table) {
            var newname = self.parameters.resource.replace(config.get('collectionName'), table._wid);
            if (newname === 'index') {
              fill(req.config.get('collectionsIndexName'))
            }
            else {
              fill(newname);
            }
        }).catch(fill);
    }).catch(fill);
})
.prepend('selector', function(req, fill) {
    var self = this, sel;
    try {
      sel = JSON.parse(self.parameters.selector, function(key, value) {
          return typeof value !== 'function' ? value : undefined;
      });
    }
    catch(e) {
      sel = {};
    }
    if (typeof sel !== 'object' || sel === null || sel === undefined) {
      sel = {};
    }
    extend(sel, { state: { $nin: [ "deleted", "hidden" ] } });
    fill(sel);
})
.append('headers', function(req, fill) {
    var headers = {};
    headers['Content-Type'] = "application/json";
    headers['Access-Control-Allow-Origin']  = '*';
    headers['Access-Control-Allow-Headers'] = 'X-Requested-With'; // TODO: check it's useful
    fill(headers);
})
.append('mongoCollection', function(req, fill) {
    if (this.parameters === false) {
      return fill();
    }
    var self = this
      , map = computer.operator(self.parameters.operator).map
      , reduce = computer.operator(self.parameters.operator).reduce
      , opts = {
          query: self.selector,
          scope: {
            exp : self.parameters.field
          }
        }
        // collection for this query (operator and opts)
      , ret = this.mongoCollection + '_' + crypto.createHash('sha1').update(self.parameters.operator + JSON.stringify(opts)).digest('hex')
      , beatoffset = pulse.missedBeats()
      ;

    debug('for ' + ret, 'beatoffset('+beatoffset+')', first.indexOf(ret));
    if (first.indexOf(ret) === -1 || (beatoffset > 2 && lock !== true) ) {
      pulse.beat();
      lock = true;
      opts.out = { replace : ret };
      debug('processing Map/Reduce, opts:', opts);
      core.connect().then(function(db) {
          db.collection(self.mongoCollection).mapReduce(map, reduce, opts).then(function(newcoll) {
              lock = false;
              if (first.indexOf(ret) === -1) {
                first.push(ret);
                fill(ret);
              }
          }).catch(function(e) {
              debug('error', e);
              if (first.indexOf(ret) === -1) {
                fill(e);
              }
          });
      }).catch(function(e) {
          debug('error', e);
          if (first.indexOf(ret) === -1) {
            fill(e);
          }
      });
    }
    if (first.indexOf(ret) > -1) {
      fill(ret);
    }
})

.append('mongoQuery', function(req, fill) {
    var sel = {};
    // cf.  http://datatables.net/manual/server-side#Sent-parameters
    // Example : /browse.json?columns[i][data]=content.json.Field&columns[i][search][value]=value
    if (this.parameters.columns) {
      this.parameters.columns.forEach(function (c) {
          if ( c && c.search && c.search.value) {
            sel[c.data] = c.search.value;
          }
      });
    }
    if (this.parameters.query) {
      var self = this;
      var q;
      try {
        q = JSON.parse(self.parameters.query, function(key, value) {
            return typeof value !== 'function' ? value : undefined;
        });
      }
      catch(e) {
        q = {};
      }
      if (typeof q !== 'object' || q === null ||q === undefined) {
        q = {};
      }
      sel.value = q;
    }
    if (this.parameters.search && this.parameters.search.regex  && this.parameters.search.value !== '') {
      sel.text = {
        $regex : this.parameters.search.value,
        $options : 'i'
      };
    }
    fill(sel);
})
.append('mongoOptions', function(req, fill) {
    fill({
        // fields : {
        // content: 0
        // }
    });
})
.complete('recordsTotal', function(req, fill) {
    if (this.parameters === false) {
      return fill(0);
    }
    core.connect().then(function(db) {
        db.collection(this.mongoCollection).find().count().then(fill).catch(fill);
    }).catch(fill);
})
.complete('recordsFiltered', function(req, fill) {
    if (this.parameters === false) {
      return fill(0);
    }
    core.connect().then(function(db) {
        db.collection(this.mongoCollection).find(this.mongoQuery, this.mongoOptions).count().then(fill).catch(fill);
    }).catch(fill);
})
.complete('data', function(req, fill) {
    var self = this;
    if (self.parameters === false) {
      return fill({});
    }
    var func = fill;
    if (self.parameters.flying) {
      func = function(r) {
        fly.affix(self.parameters.flying, self.parameters.firstOnly && Array.isArray(r) ? r[0] : r, fill);
      };
    }
    else {
      func = function(r) {
        fill(self.parameters.firstOnly && Array.isArray(r) ? r[0] : r);
      }
    }
    core.connect().then(function(db) {
        db.collection(self.mongoCollection).find(self.mongoQuery, self.mongoOptions).sort(self.mongoSort).skip(self.parameters.startIndex).limit(self.parameters.itemsPerPage).toArray().then(func).catch(fill);
    }).catch(fill);
})
.send(function(res, next) {
    if (this.parameters === false) {
      return res.status(400).send('Bad Request').end();
    }
    delete this.config
    res.set(this.headers);
    res.send(this);
  }
)
.takeout();
};

/*
 */
