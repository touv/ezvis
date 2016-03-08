/*jshint node:true,laxcomma:true*/
'use strict';

var path = require('path')
  , basename = path.basename(__filename, '.js')
  , debug = require('debug')('castor:routes:' + basename)
  , util = require('util')
  , datamodel = require('datamodel')
  , extend = require('extend')
  , Flying = require('../../helpers/flying.js')
  ;

module.exports = function(core) {
  var config = core.config
    , flyopts = {
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
      types : ['text/html', 'application/atom+xml', 'application/rss+xml', 'application/json', 'application/zip', 'text/csv']
    });
  })
  .declare('draw', function(req, fill) {
    fill(parseInt(req.query.draw, 10));
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
  .declare('selector', function(req, fill) {
    fill({ state: { $nin: [ "deleted", "hidden" ] } });
  })
  .declare('parameters', function(req, fill) {
    var schema = {
      "selector" : {
        "alias": ["sel", "select"],
        "type" : "text"
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
      if (!v.itemsPerPage) {
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
  .append('headers', function(req, fill) {
    var headers = {};
    headers['Content-Type'] = "application/json";
    headers['Access-Control-Allow-Origin']  = '*';
    headers['Access-Control-Allow-Headers'] = 'X-Requested-With'; // TODO: check it's useful
    fill(headers);
  })
  .append('recordsTotal', function(req, fill) {
    var self = this;
    if (self.parameters === false) {
      return fill(0);
    }
    core.connect().then(function(db) {
        db.collection(self.mongoCollection).find(self.selector).count().then(fill).catch(fill);
    }).catch(fill);
  })
  .append('mongoQuery', function(req, fill) {
    var sel = {};
    require('extend')(true, sel, this.selector);
    // cf.  http://datatables.net/manual/server-side#Sent-parameters
    // Example : /browse.json?columns[i][data]=content.json.Field&columns[i][search][value]=value
    if (this.parameters.columns) {
      this.parameters.columns.forEach(function (c) {
        if ( c && c.search && c.search.value) {
          sel[c.data] = c.search.value;
        }
      });
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
  .complete('recordsFiltered', function(req, fill) {
      var self = this;
      if (self.parameters === false) {
        return fill(0);
      }
    core.connect().then(function(db) {
        db.collection(self.mongoCollection).find(self.mongoQuery, self.mongoOptions).count().then(fill).catch(fill);
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
      delete this.config;
      res.set(this.headers);
      res.send(this);
  }
)
.takeout();
};
