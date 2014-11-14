/*jslint node:true */
/* global $, document, Config, Primus, Vue, c3, pathname, superagent */

$(document).ready(function () {
  'use strict';

  var vm = new Vue( {
    el: '#keydata',
    data: {
      keydata : [
        {
          label : '?',
          icon  : '?',
          value : '?'
        },
        {
          label : '?',
          icon  : '?',
          value : '?'
        },
        {
          label : '?',
          icon  : '?',
          value : '?'
        },
        {
          label : '?',
          icon  : '?',
          value : '?'
        }
      ]
    },
    ready: function() {
      var self = this;
      superagent
      .get('/corpus.json?l=1')
      .end(function(res) {
        console.log('res', res.body.data);
        var fields = Object.keys(res.body.data[0]), i = 0;
        Object.keys(Config.corpusFields).forEach(function(item) {
          if (fields.indexOf(item) && Config.corpusFields[item].visible) {
            self.keydata[i].label = Config.corpusFields[item].label;
            self.keydata[i].value = res.body.data[0][item];
            self.keydata[i].icon = Config.corpusFields[item].icon || 'dollar';
            i++;
          }
        });
      });
    },
  });

});
