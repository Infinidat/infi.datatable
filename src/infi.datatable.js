
var DataTableCollection = Backbone.Collection.extend({

    sort: '',
    page: 1,
    default_page_size: null,
    metadata: {},
    filters: {},
    loading: false,
    local_storage_prefix: 'infi.datatable.',

    initialize: function(models, options) {
        // If there's a query string in the URL, restore the collection state from it
        var self = this;
        if (window.location.search) {
            self._restore_state();
        } else {
            this._set_page_size(this._get_page_size() || this.default_page_size);
        }
        self._save_state();
        // Update the collection state when BACK button is pressed
        window.addEventListener('popstate', function(e) {
            if (e.state) {
                self._restore_state();
            }
            else {
                self._reset_state();
            }
        });
    },

    _restore_state: function() {
        // Parse query string
        var params = {};
        window.location.search.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(str, key, value) {
            params[key] = decodeURIComponent(value);
        });
        // Get the parameters we know
        this.sort = params.sort || this.sort;
        this.page = parseInt(params.page || this.page);
        // Local storage page size takes precedende on any other page size,
        this._set_page_size(parseInt(params.page_size)
            || this._get_page_size()
            || this.default_page_size)
        // All the rest are persumed to be filters
        this.filters = _.omit(params, 'sort', 'page', 'page_size');
        // Trigger an event to allow views to update their state too
        this.trigger('state:restore');
        this.reload(false);
    },

    _reset_state: function() {
        this.sort = '';
        this.page = 1;
        this._set_page_size(this._get_page_size() || this.default_page_size);
        this.filters = {};
        this.trigger('state:reset');
        this.reload(false);
    },

    _save_state: function() {
        var state = this.get_request_data();
        var query_string = '?' + $.param(state);
        if (query_string != window.location.search) {
            history.pushState(state, '', query_string);
        }
    },

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

    reload: function(save_state) {
        // Load the collection, unless it hasn't been loaded previously
        // Also pushes the state of the collection to the browser history, for BACK button support
        if (_.keys(this.metadata).length > 0) {
            if (save_state) {
                this._save_state();
            }
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
            this.reload(true);
        }
    },

    set_page: function(page) {
        if (!self.loading && this.page != page) {
            this.page = page;
            this.reload(true);
        }
    },

    set_page_size: function(page_size) {
        if (!self.loading && this.page_size != page_size) {
            this._set_page_size(page_size);
            this.page = 1;
            this.reload(true);
        }
    },

    set_filters: function(filters) {
        if (!self.loading) {
            this.filters = filters;
            this.page = 1;
            this.reload(true);
        }
    },

    _set_page_size: function(page_size) {
        this.page_size = page_size;
        localStorage.setItem(this.local_storage_prefix + 'page_size', page_size);
    },

    _get_page_size: function() {
        var item = localStorage.getItem(this.local_storage_prefix + 'page_size')
        return item ? parseInt(item) : this.default_page_size;
    }
});


var DataTable = Backbone.View.extend({

    tagName: "table",

    className: "table table-hover table-bordered infi-datatable",

    events: {
        'click .settings > button': 'handle_settings',
        'change .settings input':   'handle_visibility',
        'click th.sortable':        'handle_sort',
        'click tbody tr':           'handle_row_click'
    },

    custom_row_styles: {},

    row_template:      '<tr data-row-id="<%- model.id %>" <%= rowClassNameExpression %>>' +
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
                       '<% }) %>' +
                       '.infi-datatable { table-layout: fixed; }' +
                       '.infi-datatable caption { position: relative; padding: 0; }' +
                       '.infi-datatable th .glyphicon-chevron-down { display: none; }' +
                       '.infi-datatable th .glyphicon-chevron-up { display: none; }' +
                       '.infi-datatable th.desc .glyphicon-chevron-down { display: inline-block; }' +
                       '.infi-datatable th.asc .glyphicon-chevron-up { display: inline-block; }',

    initialize: function(options) {
        var self = this;
        self.custom_row_styles = options.custom_row_styles;
        self.columns = options.columns;
        self.row_click_callback = options.row_click_callback || _.noop;
        self.visibility = {}
        _.each(self.columns, function(column) {
            self.visibility[column.name] = _.has(column, 'visible') ? column.visible : true;
        });
        self.load_state();
        self.collection.on('reset', _.bind(self.render_tbody, self));
        self.collection.on('state:reset state:restore', _.bind(self.handle_collection_state, self));
    },

    /* Rendering */

    render: function() {
        this.$el.html('<caption></caption><thead></thead><tbody></tbody>');
        this.style = $('<style/>');
        $('head').append(this.style);
        this.render_caption();
        this.render_thead();
        this.render_tbody();
        this.render_css();
        this.handle_collection_state();
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
                th.addClass('sortable').append('<i class="glyphicon glyphicon-chevron-up"></i><i class="glyphicon glyphicon-chevron-down"></i>');
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
                var custom_classes =
                    self.custom_row_styles[model.id];
                var rowClassNameExpression = custom_classes ?
                    'class="' + custom_classes.join(' ') + '"' : '';
                tbody.append(template({
                  model: model,
                  columns: self.columns,
                  values: values,
                  rowClassNameExpression: rowClassNameExpression
                }));
            });
        }
        self.trigger('data_rendered');
    },

    render_css: function() {
        var template = _.template(this.css_template);
        this.style.html(template({self: this}));
    },

    render_sorting: function(th, asc) {
        // Mark the given th cell as sorted, in ascending or descending order.
        var tr = th.parent();
        tr.find('th').removeClass('asc desc')
        th.addClass(asc ? 'asc' : 'desc');
    },

    /* Getting info about columns */

    column_title: function(column) {
        if (_.has(column, 'title')) return column.title;
        var s = column.name.replace(/_/g, ' ');
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
        var asc = !th.hasClass('asc');
        this.render_sorting(th, asc);
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
    },

    handle_collection_state: function() {
        // Mark the sorted column
        var sort = this.collection.sort;
        var asc = true;
        if (sort.startsWith('-')) {
            sort = sort.substr(1);
            asc = false;
        }
        this.render_sorting($('thead .th_' + sort, this.el), asc);
    }

});


var DataTablePaginator = Backbone.View.extend({

    tagName: 'nav',
    className: 'infi-datatable-paginator',

    template: '&nbsp;<div class="btn-group" style="display: inline; float: right;">' +
              '    <button type="button" class="btn btn-default dropdown-toggle" data-toggle="dropdown">' +
              '        <i class="glyphicon glyphicon-cog"></i>' +
              '    </button>' +
              '    <ul class="dropdown-menu">' +
              '        <% _.each(page_sizes, function(size) { %>' +
              '            <li><a href="#" class="menu-page-size" data-size="<%= size %>">Page Size: <%= size %></i></a></li>' +
              '        <% }); %>' +
              '    </ul>' +
              '</div>',

    events: {
        'click .menu-page-size': 'handle_page_size',
    },

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
        var settings = _.template(self.template)({page_sizes: [10, 30, 100]});
        self.$el.append(settings);
        self.mark_current_page_size();
    },

    mark_current_page_size: function() {
        var size = this.collection.page_size;
        $('.menu-page-size', this.el).each(function() {
            var a = $(this);
            a.find('i').detach();
            if (a.attr('data-size') == size) {
                a.append(' <i class="glyphicon glyphicon-ok"></i>');
            }
        });
    },

    handle_page_size: function(e) {
        e.preventDefault();
        var size = $(e.target).attr('data-size');
        this.collection.set_page_size(size);
    }

});


var DataTableCounter = Backbone.View.extend({

    tagName: 'span',
    className: "infi-datatable-counter",

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


var DataTableSimpleQuery = Backbone.View.extend({

    className: "infi-datatable-simple-query",

    template: '<div class="form-group has-feedback">' +
              '    <input name="<%= field_name %>" placeholder="Search" class="form-control input-lg" maxlength="50" value="<%= field_value %>">' +
              '    <span class="glyphicon glyphicon-search form-control-feedback"></span>' +
              '</div>',

    events: {
        'input': 'handle_change'
    },

    initialize: function(options) {
        this.field_name = options.field_name || 'q';
        this.collection.on('state:reset state:restore', _.bind(this.handle_collection_state, this));

    },

    render: function() {
        var html = _.template(this.template)({
            field_name: this.field_name,
            field_value: this.collection.filters[this.field_name] || ''
        });
        this.$el.html(html);
    },

    handle_change: _.debounce(
        function(e) {
            this.apply_to_collection();
        },
        300
    ),

    get_query_params: function() {
        var params = {}
        params[this.field_name] = this.$el.find('input').val();
        return params;
    },

    apply_to_collection: function() {
        this.collection.set_filters(this.get_query_params());
    },

    handle_collection_state: function() {
        // Update the contents of the search field
        $('input', this.el).val(this.collection.filters[this.field_name]);
    }

});


var DataTableQueryBuilder = Backbone.View.extend({

    className: "infi-datatable-query-builder",

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
        this.collection.on('state:reset state:restore', _.bind(this.handle_collection_state, this));
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
        this.handle_collection_state();
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
        // Convert Query Builder operator name to API operator name
        return _.findWhere(this.operators, {type: operator}).to_api;
    },

    api_to_operator: function(api_op) {
        // Convert API operator name to Query Builder operator name
        return _.findWhere(this.operators, {to_api: api_op}).type;
    },

    get_query_params: function() {
        // Convert the current rules into API query params
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
    },

    handle_collection_state: function() {
        // Convert the collection's filters into Query Builder rules
        var self = this;
        var rules = [];
        _.each(self.collection.filters, function(value, key) {
            var operator = value.split(':')[0];
            var value = value.split(':')[1];
            if (operator == 'in' || operator == 'out' || operator == 'between') {
                value = value.split(',');
            }
            rules.push({
                id: key,
                operator: self.api_to_operator(operator),
                value: value
            });
        });
        // Initialize the Query Builder
        if (rules.length) {
            self.$el.queryBuilder('setRules', {condition: 'AND', rules: rules});
        }
        else {
            self.$el.queryBuilder('reset');
        }
    }

});