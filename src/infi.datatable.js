
var DataTableCollection = Backbone.Collection.extend({

    sort: '',
    page: 1,
    page_size: 10,
    metadata: {},
    filters: {},
    loading: false,

    load: function(on_success) {
        var self = this;
        if (!self.loading) {
            self.loading = true;
            self.fetch({
                headers: self.get_request_headers(),
                data: self.get_request_data(),
                reset: true,
                success: function(collection, response, options) {
                    self.loading = false;
                    if (on_success) on_success(collection, response, options);
                },
                error: function(collection, response, options) {
                    self.loading = false;
                }
            });
        }
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

    is_loading: function() {
        return this.loading;
    },

    get_request_headers: function() {
        return {};
    },

    get_request_data: function() {
        return _.extend({sort: this.sort, page: this.page, page_size: this.page_size}, this.filters);
    },

    set_sort: function(sort) {
        if (!self.loading && this.sort != sort) {
            this.sort = sort;
            this.page = 1;
            this.reload();
        }
    },

    set_page: function(page) {
        if (!self.loading && this.page != page) {
            this.page = page;
            this.reload();
        }
    },

    set_page_size: function(page_size) {
        if (!self.loading && this.page_size != page_size) {
            this.page_size = page_size;
            this.page = 1;
            this.reload();
        }
    },

    set_filters: function(filters) {
        if (!self.loading) {
            this.filters = filters;
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
                       '        <td class="td_<%- column.name %>"><%= values[index] %></td>' +
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
        self.load_state();
        self.collection.on('reset', _.bind(self.render_tbody, self));
    },

    /* Rendering */

    render: function() {
        this.$el.html('<caption style="position: relative; padding: 0;"></caption><thead></thead><tbody></tbody>');
        this.$el.addClass('infi-datatable').css({'table-layout': 'fixed'});
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

    render_css: function() {
        var template = _.template(this.css_template);
        this.style.html(template({self: this}));
    },

    /* Getting info about columns */

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

    /* Loading and saving the table state in session storage */

    get_storage_key: function() {
        return 'infi_datatable_' + this.id;
    },

    save_state: function() {
        var state = {visibility: this.visibility};
        sessionStorage.setItem(this.get_storage_key(), JSON.stringify(state));
    },

    load_state: function() {
        try {
            var state = JSON.parse(sessionStorage.getItem(this.get_storage_key()))
            _.extend(this.visibility, state.visibility);
        }
        catch (e) {
            console.log(e);
        }
    },

    /* Event handlers */

    handle_settings: function(e) {
        $(e.target).closest('button').next().toggleClass('hidden');
    },

    handle_visibility: function(e) {
        var self = this;
        $('.settings input', this.el).each(function() {
            self.visibility[$(this).attr('name')] = $(this).is(':checked');
        });
        self.save_state();
        self.render_css();
    },

    handle_sort: function(e) {
        if (this.collection.is_loading()) return;
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
                wrapClass: 'pagination pagination-lg',
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


var DataTableQueryBuilder = Backbone.View.extend({

    operators: [
        {type: 'contains',     to_api: 'like',      nb_inputs: 1, multiple: false, apply_to: ['string']},
        {type: 'not_contains', to_api: 'unlike',    nb_inputs: 1, multiple: false, apply_to: ['string']},
        {type: '=',            to_api: 'eq',        nb_inputs: 1, multiple: false, apply_to: ['string', 'number', 'boolean']},
        {type: '!=',           to_api: 'ne',        nb_inputs: 1, multiple: false, apply_to: ['string', 'number', 'boolean']},
        {type: '<',            to_api: 'lt',        nb_inputs: 1, multiple: false, apply_to: ['number', 'datetime']},
        {type: '<=',           to_api: 'le',        nb_inputs: 1, multiple: false, apply_to: ['number', 'datetime']},
        {type: '>',            to_api: 'gt',        nb_inputs: 1, multiple: false, apply_to: ['number', 'datetime']},
        {type: '>=',           to_api: 'ge',        nb_inputs: 1, multiple: false, apply_to: ['number', 'datetime']},
        {type: 'in',           to_api: 'in',        nb_inputs: 1, multiple: true,  apply_to: []},
        {type: 'not_in',       to_api: 'out',       nb_inputs: 1, multiple: true,  apply_to: []},
        {type: 'between',      to_api: 'between',   nb_inputs: 2, multiple: false, apply_to: ['number', 'datetime']},
    ],

    initialize: function(options) {
        this.filter_fields = options.filter_fields;
    },

    render: function() {
        this.$el.queryBuilder({
            filters: this.filter_fields,
            operators: this.operators,
            plugins: {
                'bt-tooltip-errors': { delay: 100 },
                'filter-description': {}
            },
            allow_empty: true,
            allow_groups: false,
            conditions: ['AND']
        });
    },

    update_filter: function(options, field_name) {
        for (var i = 0; i < this.filter_fields.length; i++) {
            filter_field = this.filter_fields[i];
            if (filter_field.id == field_name) {
                $.extend(filter_field, options);
                return;
            }
        }
        alert('Cannot update filter field ' + field_name);
    },

    get_rules: function() {
        return this.$el.queryBuilder('getRules');
    },

    set_rules: function(rules) {
        return this.$el.queryBuilder('setRules', rules);
    },

    validate: function() {
        return this.$el.queryBuilder('validate');
    },

    operator_to_api: function(operator) {
        return _.findWhere(this.operators, {type: operator}).to_api;
    },

    get_query_params: function() {
        var self = this;
        var rules = self.get_rules();
        var params = {}
        _.each(rules.rules, function(rule) {
            params[rule.id] = self.operator_to_api(rule.operator) + ':' + rule.value.toString();
        });
        return params
    },

    apply_to_collection: function() {
        if (this.validate()) {
            this.collection.set_filters(this.get_query_params());
        }
    }

});

