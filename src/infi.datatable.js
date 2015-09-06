
var DataTableCollection = Backbone.Collection.extend({

    sort: '',
    page: 1,
    page_size: 10,
    metadata: {},

    load: function(on_success) {
        this.fetch({
            headers: this.headers,
            data: {
                sort: this.sort,
                page: this.page,
                page_size: this.page_size
            },
            reset: true,
            success: on_success
        });
    },

    reload: function() {
        // Load the collection, unless it hasn't been loaded previously
        if (_.keys(this.metadata).length > 0) {
            this.load();
        }
    },

    parse: function(response) {
        this.metadata = response.metadata;
        return response.result;
    },

    set_sort: function(sort) {
        if (this.sort != sort) {
            this.sort = sort;
            this.page = 1;
            this.reload();
        }
    },

    set_page: function(page) {
        if (this.page != page) {
            this.page = page;
            this.reload();
        }
    },

    set_page_size: function(page_size) {
        if (this.page_size != page_size) {
            this.page_size = page_size;
            this.page = 1;
            this.reload();
        }
    }

});


var DataTable = Backbone.View.extend({

    tagName: "table",

    className: "table table-hover table-bordered",

    events: {
        'click .settings > button': 'handle_settings',
        'change .settings input':   'handle_visibility',
        'click th.sortable':        'handle_sort',
        'click tbody tr':           'handle_row_click'
    },

    row_template:      '<tr data-row-id="<%- model.id %>">' +
                       '    <% _.each(columns, function(column, index) { %>' +
                       '        <td class="td_<%- column.name %>"><%- values[index] %></td>' +
                       '    <% }) %>' +
                       '</tr>',

    settings_template: '<div class="settings" style="position: absolute; right: 5px; top: 5px;">' +
                       '    <button type="button" class="btn btn-default btn-xs"><i class="glyphicon glyphicon-th-list"></i></button>' +
                       '    <div class="panel panel-default hidden" style="position: absolute; right: 0; white-space: nowrap;">' +
                       '        <% _.each(columns, function(c) { %>' +
                       '            <label style="display: block; padding: 5px 20px 0 10px;">' +
                       '                <input type="checkbox" <% if (column_visible(c)) print("checked") %> name="<%- c.name %>"> <%- column_title(c) %></label>' +
                       '        <% }) %>' +
                       '    </div>' +
                       '</div>',

    css_template:      '<% _.each(self.columns, function(c) { %>' +
                       '    .td_<%- c.name %>, .th_<%- c.name %> {' +
                       '        display: <% print(self.column_visible(c) ? "table-cell" : "none") %>;' +
                       '        width: <%- self.column_width(c) %>;' +
                       '    }' +
                       '<% }) %>',

    initialize: function(options) {
        var self = this;
        self.columns = options.columns;
        self.row_click_callback = options.row_click_callback || _.noop;
        self.visibility = {}
        _.each(self.columns, function(column) {
            self.visibility[column.name] = _.has(column, 'visible') ? column.visible : true;
        });
        self.collection.on('reset', _.bind(self.render_tbody, self));
    },

    render: function() {
        this.$el.html('<caption style="position: relative; padding: 0;"></caption><thead></thead><tbody></tbody>');
        this.$el.css({'table-layout': 'fixed'});
        this.style = $('<style/>');
        $('head').append(this.style);
        this.render_caption();
        this.render_thead();
        this.render_tbody();
        this.render_css();
        return this;
    },

    render_caption: function() {
        var self = this;
        var settings = _.template(self.settings_template)({
            columns: self.columns,
            column_title: self.column_title,
            column_visible: _.bind(self.column_visible, self)
        });
        $('caption', this.el).append(settings);
    },

    render_thead: function() {
        var self = this;
        var thead = $('thead', self.el);
        thead.empty();
        var tr = $('<tr/>');
        thead.append(tr);
        _.each(this.columns, function(column) {
            var title = self.column_title(column);
            var th = $('<th/>').text(title).addClass('th_' + column.name).data('column', column.name);
            if (column.sortable != false) {
                th.addClass('sortable').append('<i class="glyphicon"></i>');
            }
            tr.append(th);
        });
    },

    render_tbody: function() {
        console.log('render_tbody');
        var self = this;
        var tbody = $('tbody', self.el);
        if (tbody.length == 0) {
            self.render();
        }
        else {
            tbody.empty();
            var template = _.template(self.row_template);
            self.collection.each(function(model) {
                var values = [];
                _.each(self.columns, function(column) {
                    var value = model.get(column.name);
                    if (column.render) value = column.render({model: model, column: column, value: value});
                    values.push(value);
                });
                tbody.append(template({model: model, columns: self.columns, values: values}));
            });
        }
    },

    column_title: function(column) {
        if (_.has(column, 'title')) return column.title;
        var s = column.name.replace('_', ' ');
        s = s.replace(/\w\S*/g, function(s) {
            return s.charAt(0).toUpperCase() + s.substr(1).toLowerCase();
        });
        return s;
    },

    column_width: function(column) {
        var w = _.has(column, 'width') ? column.width : 'auto';
        if (typeof w === 'number') w += 'px';
        return w;
    },

    column_visible: function(column) {
        return this.visibility[column.name];
    },

    handle_settings: function(e) {
        $(e.target).closest('button').next().toggleClass('hidden');
    },

    handle_visibility: function(e) {
        var self = this;
        $('.settings input', this.el).each(function() {
            self.visibility[$(this).attr('name')] = $(this).is(':checked');
        });
        self.render_css();
    },

    render_css: function() {
        var template = _.template(this.css_template);
        this.style.html(template({self: this}));
    },

    handle_sort: function(e) {
        var th = $(e.target).closest('th');
        var tr = th.parent();
        var asc = th.hasClass('asc');
        tr.find('th').removeClass('asc desc')
        tr.find('i').removeClass('glyphicon-chevron-down glyphicon-chevron-up');
        th.addClass(asc ? 'desc' : 'asc');
        th.find('i').addClass(asc ? 'glyphicon-chevron-down' : 'glyphicon-chevron-up');
        this.collection.set_sort((asc ? '' : '-') + th.data('column'));
    },

    handle_row_click: function(e) {
        var t = e.target.tagName;
        if (t != 'A' && t != 'BUTTON' && t != 'INPUT') {
            var tr = $(e.target).closest('tr');
            var id = tr.data('row-id');
            var model = this.collection.get(id);
            this.row_click_callback(model);
        }
    }

});


var DataTablePaginator = Backbone.View.extend({

    tagName: 'nav',

    initialize: function(options) {
        this.collection.on('reset', _.bind(this.render, this));
    },

    render: function() {
        var self = this;
        self.$el.empty();
        if (self.collection.metadata.pages_total > 1) {
            self.$el.bootpag({
                total: self.collection.metadata.pages_total,
                page: self.collection.metadata.page,
                maxVisible: 5,
                firstLastUse: true,
                first: '<i class="glyphicon glyphicon-step-backward"></i>',
                last: '<i class="glyphicon glyphicon-step-forward">',
                prev: '<i class="glyphicon glyphicon-backward"></i>',
                next: '<i class="glyphicon glyphicon-forward"></i>',
            }).on('page', function(event, num) {
                self.collection.set_page(num);
            });
        }
    }

});


var DataTableCounter = Backbone.View.extend({

    tagName: 'span',

    initialize: function(options) {
        this.collection.on('reset', _.bind(this.render, this));
    },

    render: function() {
        var self = this;
        var metadata = self.collection.metadata;
        var count = metadata.number_of_objects.toLocaleString();
        if (metadata.limited_number_of_objects && metadata.page < metadata.pages_total) {
            count = ">" + count;
        }
        else if (metadata.approximated_number_of_objects && metadata.page < metadata.pages_total) {
            count = "~" + count;
        }
        self.$el.text(count);
    }

});